import path from "node:path";
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
  it("resolves the project key as the path", () => {
    const manifest = parse(`
projects:
  backend/billing-api:
    url: git@github.com:client/billing-api.git
    desc: Billing API
    tags: [backend, billing]
  frontend/web:
    url: git@github.com:client/web.git
`);
    expect(manifest.root).toBe(path.resolve("/meta"));
    expect(manifest.manifestDir).toBe(path.resolve("/meta"));
    expect(manifest.summary).toMatchObject({ outDir: "ai/repos", index: "ai/repos/index.md" });
    expect(manifest.defaults).toMatchObject({ concurrency: 8, retries: 2 });
    const [billing, web] = manifest.projects;
    expect(billing).toMatchObject({
      name: "backend/billing-api",
      path: "backend/billing-api",
      dir: path.resolve("/meta", ..."backend/billing-api".split("/")),
      url: "git@github.com:client/billing-api.git",
      tags: ["backend", "billing"],
      desc: "Billing API",
    });
    expect(web).toMatchObject({
      name: "frontend/web",
      path: "frontend/web",
      dir: path.resolve("/meta", ..."frontend/web".split("/")),
    });
  });

  it("resolves a fleet root above the manifest", () => {
    const manifest = parse(
      `
root: ..
summary:
  outDir: aidd_docs/memory/internal
projects:
  qualifio/collect/collect:
    url: git@gitlab.example:qualifioapp/collect/collect.git
    tags: [collect]
`,
      "/meta/workspace/overrepo.yaml",
    );
    expect(manifest.root).toBe(path.resolve("/meta"));
    expect(manifest.manifestDir).toBe(path.resolve("/meta/workspace"));
    expect(manifest.projects[0]).toMatchObject({
      path: "qualifio/collect/collect",
      dir: path.resolve("/meta", ..."qualifio/collect/collect".split("/")),
    });
    expect(manifest.summary.outDir).toBe("aidd_docs/memory/internal");
    expect(manifest.summary.index).toBe("aidd_docs/memory/internal/index.md");
  });

  it("reports unknown keys with their YAML path and line", () => {
    const issues = issuesOf("projects:\n  api:\n    url: x\n    path: api\n");
    expect(issues).toEqual([
      expect.objectContaining({
        path: "projects.api.path",
        line: 4,
        message: 'unknown key "path"',
      }),
    ]);
  });

  it("rejects paths escaping the fleet root", () => {
    expect(
      issuesOf("projects:\n  ../outside:\n    url: https://example.com/x.git\n")[0]?.message,
    ).toMatch(/escapes the fleet root/);
    expect(issuesOf("root: /tmp\nprojects: {}\n")[0]?.message).toMatch(/must be relative/);
    expect(issuesOf("projects:\n  .:\n    url: https://example.com/x.git\n")[0]?.message).toMatch(
      /fleet root itself/,
    );
  });

  it("rejects duplicate paths", () => {
    expect(
      issuesOf(
        "projects:\n  Backend/Api:\n    url: https://example.com/a.git\n  backend/api:\n    url: https://example.com/b.git\n",
      )[0]?.message,
    ).toMatch(/already used/);
  });

  it("rejects tags with commas or spaces", () => {
    expect(
      issuesOf("projects:\n  a:\n    url: https://example.com/a.git\n    tags: ['a,b']\n")[0]?.path,
    ).toBe("projects.a.tags.0");
  });
});
