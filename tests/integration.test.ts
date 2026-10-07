import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { cli, createRemote, git, tempDir } from "./helpers.ts";

/** Fleet whose manifest sits in the same directory as the clones. */
function setupWorkspace(projectCount = 4) {
  const remotes = tempDir("overrepo-remotes-");
  const root = tempDir("overrepo-meta-");
  git(root, "init", "-q");
  const projects: string[] = [];
  for (let index = 0; index < projectCount; index++) {
    const backend = index % 2 === 0;
    const name = `${backend ? "api" : "web"}-${index}`;
    const dir = `${backend ? "backend" : "frontend"}/${name}`;
    const url = createRemote(remotes, name, {
      "README.md": `# ${name}\n`,
      "package.json": JSON.stringify({ name: `@client/${name}`, description: `Project ${index}` }),
    });
    projects.push(
      `  ${dir}:\n    url: ${url}\n    desc: Project ${index}\n    tags: [${backend ? "backend" : "frontend"}, node]\n`,
    );
  }
  writeFileSync(path.join(root, "overrepo.yaml"), `projects:\n${projects.join("")}`);
  return { root, remotes };
}

describe("sync", () => {
  it("clones everything in parallel and reports an unreachable repo without failing the others", async () => {
    const { root, remotes } = setupWorkspace(12);
    const manifest = readFileSync(path.join(root, "overrepo.yaml"), "utf8");
    writeFileSync(
      path.join(root, "overrepo.yaml"),
      manifest.replace(
        "projects:\n",
        `projects:\n  backend/ghost:\n    url: file://${remotes}/does-not-exist.git\n`,
      ),
    );

    const result = await cli(root, ["sync"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/backend\/ghost/);
    expect(result.stderr).toMatch(/12 ok, 1 failed, 0 skipped/);
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

    const again = await cli(root, ["sync", "--json", "--projects", "backend/api-0,frontend/web-1"]);
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
    expect(JSON.parse(result.stdout).results[0]).toMatchObject({
      path: "backend/api-0",
      action: "pulled",
    });
    expect(existsSync(path.join(root, "backend/api-0/NEW.md"))).toBe(true);
  });

  it("--dry-run touches nothing", async () => {
    const { root } = setupWorkspace(2);
    const result = await cli(root, ["sync", "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/would clone/);
    expect(existsSync(path.join(root, "backend"))).toBe(false);
  });
});

describe("init", () => {
  it("builds a manifest from clones that have an origin", async () => {
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
    mkdirSync(path.join(fresh, "tools/local"), { recursive: true });
    git(path.join(fresh, "tools/local"), "init", "-q");

    const init = await cli(fresh, ["init"]);
    expect(init.code).toBe(0);
    expect(init.stderr).toMatch(/2 project/);
    expect(init.stderr).toMatch(/tools\/local: no "origin" remote, skipped/);
    const text = readFileSync(path.join(fresh, "overrepo.yaml"), "utf8");
    expect(text).toMatch(
      /backend\/api-0:\n {4}url: .+\n {4}desc: Project 0\n {4}tags: \[ backend \]/,
    );
    expect(text).not.toContain("tools/local");

    const list = JSON.parse((await cli(fresh, ["list", "--json"])).stdout) as Array<{
      path: string;
      cloned: boolean;
    }>;
    expect(list.map((project) => project.path)).toEqual(["backend/api-0", "frontend/web-1"]);

    const sync = await cli(fresh, ["sync", "--json"]);
    expect(sync.code).toBe(0);
    expect(
      JSON.parse(sync.stdout).results.map((entry: { action: string }) => entry.action),
    ).toEqual(["present", "present"]);

    expect((await cli(fresh, ["init"])).code).toBe(2);
  });

  it("follows directory symlinks and skips the scan root and t3 worktrees", async () => {
    const hub = tempDir("overrepo-scan-");
    git(hub, "init", "-q");
    const real = tempDir("overrepo-real-");
    writeFileSync(path.join(real, "README.md"), "# collect\n");
    git(real, "init", "-q");
    git(real, "add", "-A");
    git(real, "commit", "-q", "-m", "init");
    git(real, "remote", "add", "origin", "file:///collect.git");
    mkdirSync(path.join(hub, "qualifio"), { recursive: true });
    symlinkSync(real, path.join(hub, "qualifio", "collect"), "dir");
    const worktree = path.join(hub, "t3-abc");
    mkdirSync(worktree, { recursive: true });
    git(worktree, "init", "-q");

    const init = await cli(hub, ["init", "--dry-run"]);
    expect(init.code).toBe(0);
    expect(init.stdout).toContain("qualifio/collect:");
    expect(init.stdout).toContain("url: file:///collect.git");
    expect(init.stdout).not.toContain("t3-abc");
    expect(init.stdout).not.toMatch(/^ {2}\.:/m);
  });
});

describe("exec and status", () => {
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
    expect(entries.map((entry) => entry.name)).toEqual(["backend/api-0", "backend/api-2"]);
    expect(entries[0]?.stdout).toBe("?? dirty.txt");
  });

  it("prefixes parallel output and reports failures with exit code 1", async () => {
    const result = await cli(root, [
      "exec",
      "--all",
      "-j",
      "4",
      "echo hi; test $OVERREPO_PROJECT != frontend/web-3",
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^backend\/api-0 +│ hi$/m);
    expect(result.stderr).toMatch(/frontend\/web-3 .*exit code 1/);
    expect(result.stderr).toMatch(/3 ok, 1 failed, 0 skipped/);
  });

  it("reports aggregated status", async () => {
    const result = await cli(root, ["status", "--json"]);
    expect(result.code).toBe(0);
    const entries = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    expect(entries[0]).toMatchObject({
      name: "backend/api-0",
      state: "present",
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      dirty: true,
    });
    expect(entries[1]).toMatchObject({ name: "frontend/web-1", dirty: false });
  });
});

describe("meta-folder", () => {
  it("clones beside the manifest and does not write a gitignore", async () => {
    const hub = tempDir("overrepo-hub-");
    const workspace = path.join(hub, "workspace");
    mkdirSync(workspace, { recursive: true });
    git(workspace, "init", "-q");
    const url = createRemote(tempDir("overrepo-hub-remotes-"), "collect", {
      "README.md": "# collect\n",
    });
    writeFileSync(
      path.join(workspace, "overrepo.yaml"),
      [
        "root: ..",
        "projects:",
        "  qualifio/collect/collect:",
        `    url: ${url}`,
        "    tags: [collect]",
        "",
      ].join("\n"),
    );

    const args = ["-c", "workspace/overrepo.yaml"];
    const synced = await cli(hub, [...args, "sync", "--tags", "collect"]);
    expect(synced.code).toBe(0);
    expect(existsSync(path.join(hub, "qualifio/collect/collect/README.md"))).toBe(true);
    expect(existsSync(path.join(hub, ".gitignore"))).toBe(false);

    const listed = JSON.parse((await cli(hub, [...args, "list", "--json"])).stdout) as Array<{
      path: string;
    }>;
    expect(listed.map((project) => project.path)).toEqual(["qualifio/collect/collect"]);

    const doctor = await cli(hub, [...args, "doctor", "--no-network", "--json"]);
    expect(doctor.code).toBe(0);
    const checks = JSON.parse(doctor.stdout).checks as Array<{ id: string; level: string }>;
    expect(checks.find((check) => check.id === "orphans")).toMatchObject({ level: "ok" });
  });
});

describe("context", () => {
  it("writes summaries from origin/HEAD next to the manifest and ignores a dirty tree", async () => {
    const hub = tempDir("overrepo-summary-");
    const workspace = path.join(hub, "workspace");
    mkdirSync(workspace, { recursive: true });
    const url = createRemote(tempDir("overrepo-summary-remotes-"), "collect", {
      "README.md": "# collect\n\ncommitted body\n",
      "package.json": JSON.stringify({ name: "collect", scripts: { test: "echo ok" } }),
    });
    writeFileSync(
      path.join(workspace, "overrepo.yaml"),
      [
        "root: ..",
        "summary:",
        "  outDir: aidd_docs/memory/internal",
        "projects:",
        "  qualifio/collect/collect:",
        `    url: ${url}`,
        "    tags: [collect]",
        "    desc: Collect",
        "",
      ].join("\n"),
    );
    const args = ["-c", "workspace/overrepo.yaml"];
    expect((await cli(hub, [...args, "sync", "--tags", "collect"])).code).toBe(0);
    const clone = path.join(hub, "qualifio/collect/collect");
    writeFileSync(path.join(clone, "README.md"), "# collect\n\nDIRTY body\n");

    expect((await cli(hub, [...args, "context"])).code).toBe(0);
    const card = path.join(workspace, "aidd_docs/memory/internal/qualifio/collect/collect.md");
    const index = path.join(workspace, "aidd_docs/memory/internal/index.md");
    expect(existsSync(index)).toBe(true);
    const text = readFileSync(card, "utf8");
    expect(text).toContain("committed body");
    expect(text).not.toContain("DIRTY");
    expect(text).toContain("Collect");

    const again = await cli(hub, [...args, "context", "--json"]);
    expect(again.code).toBe(0);
    expect(
      JSON.parse(again.stdout).files.every(
        (file: { status: string }) => file.status === "unchanged",
      ),
    ).toBe(true);
    expect((await cli(hub, [...args, "context", "--check"])).code).toBe(0);

    writeFileSync(card, text.replace("Collect", "Changed"));
    expect((await cli(hub, [...args, "context", "--check"])).code).toBe(1);
    expect(readFileSync(card, "utf8")).toContain("Changed");
    expect(
      (await cli(hub, [...args, "exec", "--tags", "collect", "--", "git", "status", "-s"])).code,
    ).toBe(0);
  });
});

describe("import", () => {
  it("adds, updates and reports missing projects while keeping comments", async () => {
    const root = tempDir("overrepo-import-");
    writeFileSync(
      path.join(root, "overrepo.yaml"),
      "# header comment\nprojects:\n  # the API\n  backend/api:\n    url: git@github.com:client/api.git\n  old:\n    url: git@github.com:client/old.git\n",
    );
    const input = JSON.stringify({
      projects: [
        {
          name: "backend/api",
          url: "https://github.com/client/api",
          desc: "API",
          tags: ["backend"],
        },
        { name: "frontend/web", url: "git@github.com:client/web.git", tags: ["frontend"] },
      ],
    });

    const result = await cli(root, ["import", "--json"], input);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      added: ["frontend/web"],
      updated: { "backend/api": ["desc", "tags"] },
      missing: ["old"],
      removed: [],
    });
    const text = readFileSync(path.join(root, "overrepo.yaml"), "utf8");
    expect(text).toContain("# header comment");
    expect(text).toContain("  # the API\n  backend/api:");
    expect(text).toContain("    tags: [ backend ]");
    expect(text).toContain("  frontend/web:\n    url: git@github.com:client/web.git");

    const pruned = await cli(root, ["import", "--prune"], input);
    expect(pruned.code).toBe(0);
    expect(readFileSync(path.join(root, "overrepo.yaml"), "utf8")).not.toContain("old:");

    expect((await cli(root, ["import"], "{nope")).code).toBe(2);
    expect(
      (
        await cli(
          root,
          ["import"],
          JSON.stringify([{ name: "bad", path: "other", url: "https://example.com/a.git" }]),
        )
      ).code,
    ).toBe(2);
    expect(
      (
        await cli(
          root,
          ["import"],
          JSON.stringify([{ name: "../x", url: "https://example.com/x.git" }]),
        )
      ).code,
    ).toBe(2);
  });

  it("writes projects as a block map and clones only what it added", async () => {
    const root = tempDir("overrepo-import-flow-");
    const remotes = tempDir("overrepo-import-remotes-");
    const oldUrl = createRemote(remotes, "old");
    const webUrl = createRemote(remotes, "web");
    writeFileSync(path.join(root, "overrepo.yaml"), "projects: {}\n");
    const imported = await cli(
      root,
      ["import"],
      JSON.stringify({
        projects: [
          { name: "frontend/web", url: webUrl, tags: ["frontend", "node"] },
          { name: "libraries/lib", url: "https://example.com/lib.git", tags: ["libraries"] },
        ],
      }),
    );
    expect(imported.code).toBe(0);
    const text = readFileSync(path.join(root, "overrepo.yaml"), "utf8");
    expect(text).toMatch(/projects:\n {2}frontend\/web:/);
    expect(text).toContain("tags: [ frontend, node ]");
    expect(text.split("\n").length).toBeGreaterThan(6);

    writeFileSync(path.join(root, "overrepo.yaml"), `projects:\n  old:\n    url: ${oldUrl}\n`);
    const synced = await cli(
      root,
      ["import", "--sync", "--json"],
      JSON.stringify({ projects: [{ name: "frontend/web", url: webUrl }] }),
    );
    expect(synced.code).toBe(0);
    expect(existsSync(path.join(root, "frontend/web/README.md"))).toBe(true);
    expect(existsSync(path.join(root, "old"))).toBe(false);
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
    writeFileSync(
      path.join(root, "overrepo.yaml"),
      "projects:\n  ../x:\n    url: https://example.com/x.git\n",
    );
    expect((await cli(root, ["doctor", "--no-network"])).code).toBe(2);
    const list = await cli(root, ["list"]);
    expect(list.code).toBe(2);
    expect(list.stderr).toMatch(/escapes the fleet root/);
  });
});

describe("cli", () => {
  it("prints help and version", async () => {
    const help = await cli(tempDir(), ["--help"]);
    expect(help.stdout).toContain("Usage: overrepo");
    expect(help.stdout).toContain("sync");
    expect(help.stdout).toMatch(/\bcontext\b/);
    expect(help.stdout).not.toMatch(/\n {2}run\b/);
    expect((await cli(tempDir(), ["--version"])).stdout).toMatch(/^\d+\.\d+\.\d+/);
    expect((await cli(tempDir(), ["list"])).code).toBe(2);
  });
});
