import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { cli, createRemote, git, tempDir, writeFiles } from "./helpers.ts";

/** Meta-repo with remotes for backend/frontend projects. */
function setupWorkspace(projectCount = 4) {
  const remotes = tempDir("overrepo-remotes-");
  const root = tempDir("overrepo-meta-");
  git(root, "init", "-q");
  const projects: string[] = [];
  for (let index = 0; index < projectCount; index++) {
    const backend = index % 2 === 0;
    const name = `${backend ? "api" : "web"}-${index}`;
    const url = createRemote(remotes, name, {
      "README.md": `# ${name}\n\nService number ${index}.\n\n## Usage\n\nRun it.\n`,
      "package.json": JSON.stringify({
        name: `@client/${name}`,
        scripts: { test: "echo ok" },
        dependencies: index === 1 ? { "@client/api-0": "^1.0.0" } : {},
      }),
      "src/index.js": "export {};\n",
    });
    projects.push(
      `  ${name}:\n    path: ${backend ? "backend" : "frontend"}/${name}\n    url: ${url}\n    desc: Project ${index}\n    tags: [${backend ? "backend" : "frontend"}, node]\n`,
    );
  }
  writeFileSync(
    path.join(root, "overrepo.yaml"),
    `# shared meta-repo manifest\nversion: 1\ndefaults:\n  concurrency: 4\n  retries: 0\nprojects:\n${projects.join("")}tasks:\n  hello:\n    desc: Say hello\n    cmd: echo hello from $OVERREPO_PROJECT\n`,
  );
  writeFileSync(path.join(root, ".gitignore"), "node_modules\n# keep me\n");
  return { root, remotes };
}

describe("sync", () => {
  it("clones everything in parallel, reports an unreachable repo without failing the others", async () => {
    const { root, remotes } = setupWorkspace(12);
    const manifest = readFileSync(path.join(root, "overrepo.yaml"), "utf8");
    writeFileSync(
      path.join(root, "overrepo.yaml"),
      manifest.replace(
        "projects:\n",
        `projects:\n  ghost:\n    path: backend/ghost\n    url: file://${remotes}/does-not-exist.git\n  listed:\n    path: misc/listed\n    url: file://${remotes}/nope.git\n    sync: false\n`,
      ),
    );

    const result = await cli(root, ["sync"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/ghost/);
    expect(result.stderr).toMatch(/12 ok, 1 failed, 1 skipped/);
    for (let index = 0; index < 12; index++) {
      const dir = path.join(
        root,
        index % 2 === 0 ? "backend" : "frontend",
        `${index % 2 === 0 ? "api" : "web"}-${index}`,
      );
      expect(existsSync(path.join(dir, ".git"))).toBe(true);
    }
    expect(existsSync(path.join(root, "backend/ghost"))).toBe(false);
    expect(existsSync(path.join(root, "backend/.ghost.overrepo-partial"))).toBe(false);
    expect(existsSync(path.join(root, "misc/listed"))).toBe(false);

    const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(gitignore.startsWith("node_modules\n# keep me\n\n# >>> overrepo (managed) >>>\n")).toBe(
      true,
    );
    expect(gitignore).toContain("/backend/api-0/\n");
    expect(gitignore).toContain("/misc/listed/\n");
    // The meta-repo sees no untracked project directories.
    expect(
      git(root, "status", "--porcelain", "--untracked-files=all")
        .split("\n")
        .filter((line) => line.includes("backend/api")),
    ).toEqual([]);

    const again = await cli(root, ["sync", "--json", "--projects", "api-0,web-1"]);
    expect(again.code).toBe(0);
    expect(
      JSON.parse(again.stdout).results.map((entry: { action: string }) => entry.action),
    ).toEqual(["present", "present"]);
  });

  it("--pull fast-forwards existing clones", async () => {
    const { root, remotes } = setupWorkspace(2);
    expect((await cli(root, ["sync"])).code).toBe(0);
    const source = path.join(remotes, "api-0.git-src");
    writeFileSync(path.join(source, "NEW.md"), "new\n");
    git(source, "add", "-A");
    git(source, "commit", "-q", "-m", "second");

    const result = await cli(root, ["sync", "--pull", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).results[0]).toMatchObject({ name: "api-0", action: "pulled" });
    expect(existsSync(path.join(root, "backend/api-0/NEW.md"))).toBe(true);
  });

  it("--dry-run touches nothing", async () => {
    const { root } = setupWorkspace(2);
    const result = await cli(root, ["sync", "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/would clone/);
    expect(existsSync(path.join(root, "backend"))).toBe(false);
    expect(readFileSync(path.join(root, ".gitignore"), "utf8")).toBe("node_modules\n# keep me\n");
  });
});

describe("init", () => {
  it("builds a valid manifest from existing clones; sync then clones nothing", async () => {
    const { root } = setupWorkspace(4);
    await cli(root, ["sync"]);
    const fresh = tempDir("overrepo-init-");
    for (const dir of ["backend/api-0", "frontend/web-1"]) {
      mkdirSync(path.join(fresh, path.dirname(dir)), { recursive: true });
      git(
        path.join(fresh, path.dirname(dir)),
        "clone",
        "-q",
        path.join(root, dir),
        path.basename(dir),
      );
    }
    // A local repo without remote is still listed.
    mkdirSync(path.join(fresh, "tools/local"), { recursive: true });
    git(path.join(fresh, "tools/local"), "init", "-q");

    const init = await cli(fresh, ["init"]);
    expect(init.code).toBe(0);
    expect(init.stderr).toMatch(/3 project/);
    const text = readFileSync(path.join(fresh, "overrepo.yaml"), "utf8");
    expect(text).toMatch(/api-0:\n {4}path: backend\/api-0\n {4}url: .+\n {4}tags: \[ backend \]/);

    const list = JSON.parse((await cli(fresh, ["list", "--json"])).stdout) as Array<{
      name: string;
      cloned: boolean;
    }>;
    expect(list.map((project) => project.name)).toEqual(["api-0", "web-1", "local"]);

    const sync = await cli(fresh, ["sync", "--json"]);
    expect(sync.code).toBe(0);
    expect(
      JSON.parse(sync.stdout).results.map((entry: { action: string }) => entry.action),
    ).toEqual(["present", "present", "present"]);

    expect((await cli(fresh, ["init"])).code).toBe(2);
  });

  it("converts mani.yaml with --from-mani and reads mani.yaml as-is", async () => {
    const root = tempDir("overrepo-mani-");
    const mani =
      "projects:\n  api:\n    path: backend/api\n    url: git@example.com:client/api.git\n    tags: [backend]\ntasks:\n  hello: echo hello\n";
    writeFileSync(path.join(root, "mani.yaml"), mani);

    const listed = await cli(root, ["list", "--names"]);
    expect(listed).toMatchObject({ code: 0, stdout: "api\n" });
    expect(readFileSync(path.join(root, "mani.yaml"), "utf8")).toBe(mani);

    expect((await cli(root, ["init", "--from-mani"])).code).toBe(0);
    const converted = readFileSync(path.join(root, "overrepo.yaml"), "utf8");
    expect(converted).toContain("backend/api");
    expect(converted).toContain("hello: echo hello");
    expect(readFileSync(path.join(root, "mani.yaml"), "utf8")).toBe(mani);
  });
});

describe("exec, run, status", () => {
  let root: string;
  beforeAll(async () => {
    ({ root } = setupWorkspace(4));
    await cli(root, ["sync"]);
  });

  it("requires a selection", async () => {
    const result = await cli(root, ["exec", "--", "git", "status"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/no projects selected/);
  });

  it("only touches tagged projects", async () => {
    writeFileSync(path.join(root, "backend/api-0/dirty.txt"), "x");
    const result = await cli(root, [
      "exec",
      "--tags",
      "backend",
      "--json",
      "--",
      "git",
      "status",
      "-s",
    ]);
    expect(result.code).toBe(0);
    const entries = JSON.parse(result.stdout) as Array<{ name: string; stdout: string }>;
    expect(entries.map((entry) => entry.name)).toEqual(["api-0", "api-2"]);
    expect(entries[0]?.stdout).toBe("?? dirty.txt");
  });

  it("prefixes parallel output and reports failures with exit code 1", async () => {
    const result = await cli(root, [
      "exec",
      "--all",
      "-j",
      "4",
      "echo hi; test $OVERREPO_PROJECT != web-3",
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^api-0 +│ hi$/m);
    expect(result.stderr).toMatch(/web-3 .*exit code 1/);
    expect(result.stderr).toMatch(/3 ok, 1 failed, 0 skipped/);
  });

  it("runs manifest tasks", async () => {
    const result = await cli(root, ["run", "hello", "--paths", "frontend", "--output", "grouped"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hello from web-1");
    expect(result.stdout).toContain("hello from web-3");
    expect(result.stdout).not.toContain("api-0");
    expect((await cli(root, ["run", "nope", "--all"])).code).toBe(2);
    expect((await cli(root, ["run"])).stdout).toMatch(/hello +Say hello/);
  });

  it("reports aggregated status", async () => {
    const result = await cli(root, ["status", "--json"]);
    expect(result.code).toBe(0);
    const entries = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    expect(entries[0]).toMatchObject({
      name: "api-0",
      state: "present",
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      dirty: true,
    });
    expect(entries[1]).toMatchObject({ name: "web-1", dirty: false });
  });
});

describe("context", () => {
  it("generates index and cards idempotently, preserves manual notes, detects staleness", async () => {
    const { root } = setupWorkspace(4);
    const manifestPath = path.join(root, "overrepo.yaml");
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, "utf8").replace("  web-3:\n", "  web-3:\n    sync: false\n"),
    );
    await cli(root, ["sync"]);
    writeFiles(path.join(root, "backend/api-0"), { "AGENTS.md": "# rules\n" });
    git(path.join(root, "backend/api-0"), "add", "-A");
    git(path.join(root, "backend/api-0"), "commit", "-q", "-m", "agents");

    const first = await cli(root, ["context"]);
    expect(first.code).toBe(0);
    const index = readFileSync(path.join(root, "ai/repos/index.md"), "utf8");
    expect(index).toContain(
      "| [api-0](backend/api-0.md) | `backend/api-0/` | Project 0 | backend, node |",
    );
    expect(index).toMatch(/## backend\n/);
    expect(index).toMatch(/## frontend\n/);

    const cardFile = path.join(root, "ai/repos/backend/api-0.md");
    const card = readFileSync(cardFile, "utf8");
    expect(card).toMatch(/^---\nname: api-0\npath: backend\/api-0\n/);
    expect(card).toContain("- [AGENTS.md](../../../backend/api-0/AGENTS.md)");
    expect(card).toContain("**Languages:** JavaScript");
    expect(card).toContain("- `npm run test` — `echo ok`");
    expect(card).toContain(
      "Used by:\n\n- [web-1](../frontend/web-1.md) — npm package `@client/api-0`",
    );
    expect(card).toContain("```text\nsrc/\nAGENTS.md\nREADME.md\npackage.json\n```");
    expect(card).toContain("## README (excerpt)\n\nService number 0.\n\n#### Usage");
    expect(card).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(readFileSync(path.join(root, "ai/repos/frontend/web-3.md"), "utf8")).toContain(
      "**Not cloned locally.**",
    );

    const second = await cli(root, ["context", "--json"]);
    expect(
      JSON.parse(second.stdout).files.every(
        (file: { status: string }) => file.status === "unchanged",
      ),
    ).toBe(true);
    expect((await cli(root, ["context", "--check"])).code).toBe(0);

    writeFileSync(
      cardFile,
      card.replace(
        "<!-- Human notes go here: this block is kept as-is when the file is regenerated. -->",
        "Deploys on Fridays are forbidden.",
      ),
    );
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, "utf8").replace("desc: Project 0", "desc: Billing API"),
    );
    const check = await cli(root, ["context", "--check"]);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain("stale ai/repos/backend/api-0.md");

    expect((await cli(root, ["context"])).code).toBe(0);
    const regenerated = readFileSync(cardFile, "utf8");
    expect(regenerated).toContain("Billing API");
    expect(regenerated).toContain(
      "<!-- overrepo:manual -->\nDeploys on Fridays are forbidden.\n<!-- /overrepo:manual -->",
    );
    expect((await cli(root, ["context", "--check"])).code).toBe(0);

    // Orphan cards are reported, then pruned on request.
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, "utf8").replace(/ {2}web-3:\n(?: {4}.*\n)+/, ""),
    );
    expect((await cli(root, ["context", "--check"])).code).toBe(1);
    const pruned = await cli(root, ["context", "--prune"]);
    expect(pruned.stderr).toContain("removed ai/repos/frontend/web-3.md");
    expect(existsSync(path.join(root, "ai/repos/frontend/web-3.md"))).toBe(false);
  });

  it("bounds the card size", async () => {
    const { root } = setupWorkspace(1);
    writeFileSync(
      path.join(root, "overrepo.yaml"),
      readFileSync(path.join(root, "overrepo.yaml"), "utf8").replace(
        "defaults:",
        "context:\n  maxBytes: 2000\ndefaults:",
      ),
    );
    await cli(root, ["sync"]);
    writeFiles(path.join(root, "backend/api-0"), {
      "README.md": `# api\n\n${"Lorem ipsum dolor sit amet. ".repeat(400)}\n`,
    });
    await cli(root, ["context"]);
    const card = readFileSync(path.join(root, "ai/repos/backend/api-0.md"), "utf8");
    const generated = card.slice(0, card.indexOf("<!-- overrepo:manual -->"));
    expect(Buffer.byteLength(generated)).toBeLessThanOrEqual(2002);
    expect(card).toContain("<!-- /overrepo:manual -->");
  });
});

describe("import", () => {
  it("adds, updates and reports missing projects while keeping comments", async () => {
    const root = tempDir("overrepo-import-");
    writeFileSync(
      path.join(root, "overrepo.yaml"),
      "# header comment\nprojects:\n  # the API\n  api:\n    path: backend/api\n    url: git@github.com:client/api.git\n  old:\n    url: git@github.com:client/old.git\n",
    );
    const input = JSON.stringify({
      projects: [
        {
          name: "api-renamed",
          url: "https://github.com/client/api",
          desc: "API",
          tags: ["backend"],
        },
        {
          name: "web",
          path: "frontend/web",
          url: "git@github.com:client/web.git",
          tags: ["frontend"],
          stars: 3,
        },
      ],
    });

    const result = await cli(root, ["import", "--json"], input);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      added: ["web"],
      updated: { api: ["desc", "tags"] },
      missing: ["old"],
      removed: [],
    });
    const text = readFileSync(path.join(root, "overrepo.yaml"), "utf8");
    expect(text).toContain("# header comment");
    expect(text).toContain("  # the API\n  api:");
    expect(text).toContain("    tags: [ backend ]");
    expect(text).toContain("  web:\n    path: frontend/web");

    const pruned = await cli(root, ["import", "--prune"], input);
    expect(pruned.code).toBe(0);
    expect(readFileSync(path.join(root, "overrepo.yaml"), "utf8")).not.toContain("old:");

    expect((await cli(root, ["import"], "{nope")).code).toBe(2);
    expect(
      (await cli(root, ["import"], JSON.stringify([{ name: "bad", path: "../x" }]))).code,
    ).toBe(2);
  });
});

describe("doctor", () => {
  it("detects orphans and interrupted clones", async () => {
    const { root } = setupWorkspace(2);
    await cli(root, ["sync"]);
    mkdirSync(path.join(root, "backend/stray"), { recursive: true });
    git(path.join(root, "backend/stray"), "init", "-q");
    mkdirSync(path.join(root, "backend/.half.overrepo-partial"), { recursive: true });

    const result = await cli(root, ["doctor", "--json"]);
    expect(result.code).toBe(1);
    const checks = JSON.parse(result.stdout).checks as Array<{
      id: string;
      level: string;
      details?: string[];
    }>;
    expect(checks.find((check) => check.id === "orphans")).toMatchObject({
      level: "warn",
      details: ["backend/stray"],
    });
    expect(checks.find((check) => check.id === "partial-clones")).toMatchObject({ level: "fail" });
    expect(checks.find((check) => check.id.startsWith("access:"))).toMatchObject({ level: "ok" });
  });

  it("exits with 2 on an invalid manifest", async () => {
    const root = tempDir();
    writeFileSync(path.join(root, "overrepo.yaml"), "projects:\n  a:\n    path: ../x\n");
    expect((await cli(root, ["doctor", "--no-network"])).code).toBe(2);
    const list = await cli(root, ["list"]);
    expect(list.code).toBe(2);
    expect(list.stderr).toMatch(
      /overrepo\.yaml:3:11 projects\.a\.path: path "\.\.\/x" escapes the manifest root/,
    );
  });
});

describe("cli", () => {
  it("prints help and version", async () => {
    expect((await cli(tempDir(), ["--help"])).stdout).toContain("Usage: overrepo");
    expect((await cli(tempDir(), ["--version"])).stdout).toMatch(/^\d+\.\d+\.\d+/);
    expect((await cli(tempDir(), ["list"])).code).toBe(2);
  });
});
