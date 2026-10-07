import { describe, expect, it } from "vite-plus/test";
import { ManifestError } from "../src/core/errors.ts";
import { parseManifest } from "../src/core/manifest.ts";

const parse = (text: string, file = "/meta/overrepo.yaml") => parseManifest(text, file);

function issuesOf(text: string, file?: string): ManifestError["issues"] {
  try {
    parse(text, file);
  } catch (error) {
    if (error instanceof ManifestError) return error.issues;
    throw error;
  }
  throw new Error("expected a ManifestError");
}

describe("parseManifest", () => {
  it("resolves defaults and project settings", () => {
    const manifest = parse(`
version: 1
defaults:
  concurrency: 4
  clone:
    depth: 1
projects:
  billing-api:
    path: backend/billing-api/
    url: git@github.com:client/billing-api.git
    desc: Billing API
    tags: [backend, billing]
    clone:
      branch: develop
  web:
tasks:
  pull: git pull --ff-only
  lint:
    desc: Lint
    cmd: npm run lint
`);
    expect(manifest.root).toBe("/meta");
    expect(manifest.defaults).toMatchObject({ concurrency: 4, retries: 2 });
    expect(manifest.context).toMatchObject({ outDir: "ai/repos", index: "ai/repos/index.md" });
    expect(manifest.gitignore.sync).toBe(true);
    const [billing, web] = manifest.projects;
    expect(billing).toMatchObject({
      name: "billing-api",
      path: "backend/billing-api",
      dir: "/meta/backend/billing-api",
      tags: ["backend", "billing"],
      sync: true,
      clone: { depth: 1, filter: "blob:none", branch: "develop" },
    });
    expect(web).toMatchObject({ name: "web", path: "web", url: undefined, tags: [] });
    expect(manifest.tasks.pull).toEqual({
      name: "pull",
      desc: undefined,
      cmd: "git pull --ff-only",
    });
    expect(manifest.tasks.lint?.cmd).toBe("npm run lint");
  });

  it("reports unknown keys with their YAML path and line", () => {
    const issues = issuesOf("projects:\n  api:\n    url: x\n    descr: typo\n");
    expect(issues).toEqual([
      expect.objectContaining({
        path: "projects.api.descr",
        line: 4,
        message: 'unknown key "descr"',
      }),
    ]);
  });

  it("reports type errors with their location", () => {
    const issues = issuesOf("defaults:\n  concurrency: lots\n");
    expect(issues[0]).toMatchObject({ path: "defaults.concurrency", line: 2 });
  });

  it("rejects paths escaping the root", () => {
    expect(issuesOf("projects:\n  a:\n    path: ../outside\n")[0]?.message).toMatch(
      /escapes the manifest root/,
    );
    expect(issuesOf("projects:\n  a:\n    path: /abs\n")[0]?.message).toMatch(/must be relative/);
    expect(issuesOf("projects:\n  a:\n    path: .\n")[0]?.message).toMatch(/root itself/);
  });

  it("rejects duplicate paths and names", () => {
    expect(issuesOf("projects:\n  a:\n    path: x/y\n  b:\n    path: x/y/\n")[0]).toMatchObject({
      path: "projects.b.path",
      message: 'path "x/y" is already used by project "a"',
    });
    expect(issuesOf("projects:\n  a: {}\n  a: {}\n")[0]?.message).toMatch(/unique/i);
  });

  it("rejects projects inside the context directory", () => {
    expect(issuesOf("projects:\n  a:\n    path: ai/repos/a\n")[0]?.message).toMatch(
      /context.outDir/,
    );
  });

  it("rejects tags with commas or spaces", () => {
    expect(issuesOf("projects:\n  a:\n    tags: ['a,b']\n")[0]?.path).toBe("projects.a.tags.0");
  });

  it("reads the supported subset of mani.yaml", () => {
    const manifest = parse(
      `
import: [other.yaml]
projects:
  meta:
    path: .
  api:
    path: backend/api
    url: git@github.com:client/api.git
    desc: API
    tags: [backend]
    branch: develop
    env:
      FOO: bar
tasks:
  hello: echo hello
  multi:
    commands:
      - cmd: echo 1
  pull:
    desc: Pull
    cmd: git pull
    target: all
`,
      "/meta/mani.yaml",
    );
    expect(manifest.format).toBe("mani");
    expect(manifest.projects.map((project) => project.name)).toEqual(["api"]);
    expect(manifest.projects[0]?.clone.branch).toBe("develop");
    expect(Object.keys(manifest.tasks)).toEqual(["hello", "pull"]);
    expect(manifest.warnings.join("\n")).toMatch(/projects\.api\.env/);
    expect(manifest.warnings.join("\n")).toMatch(/"meta" points to the root/);
  });
});
