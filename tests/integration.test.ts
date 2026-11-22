import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { analyzeProject } from "../src/context/analyze.ts";
import type { Analysis } from "../src/context/analyze.ts";
import { cli, createRemote, git, parseJson, tempDir } from "./helpers.ts";
import type { TestRun } from "./helpers.ts";

const syncJson = z.object({
  results: z.array(z.object({ path: z.string(), action: z.string().nullable() })),
});

const listJson = z.array(z.object({ path: z.string(), cloned: z.boolean() }));

const doctorJson = z.object({
  checks: z.array(
    z.object({ id: z.string(), level: z.string(), details: z.array(z.string()).optional() }),
  ),
});

const actionsOf = (run: TestRun) =>
  parseJson(syncJson, run.stdout).results.map((entry) => entry.action);

/** Fleet whose manifest sits in the same directory as the clones */
const setupWorkspace = (projectCount = 4) => {
  const remotes = tempDir("overrepo-remotes-");
  const root = tempDir("overrepo-meta-");
  git(root, "init", "-q");
  const projects: string[] = [];

  for (let index = 0; index < projectCount; index += 1) {
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
};

describe("sync", () => {
  describe("with an unreachable repo among 12", () => {
    let root: string;
    let result: TestRun;
    let again: TestRun;

    beforeAll(async () => {
      let remotes: string;
      ({ root, remotes } = setupWorkspace(12));
      const manifest = readFileSync(path.join(root, "overrepo.yaml"), "utf-8");
      writeFileSync(
        path.join(root, "overrepo.yaml"),
        manifest.replace(
          "projects:\n",
          `projects:\n  backend/ghost:\n    url: file://${remotes}/does-not-exist.git\n`,
        ),
      );

      result = await cli(root, ["sync"]);
      again = await cli(root, ["sync", "--json", "--projects", "backend/api-0,frontend/web-1"]);
    });

    it("reports the unreachable repo without failing the others", () => {
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/backend\/ghost/u);
      expect(result.stderr).toMatch(/12 ok, 1 failed, 0 skipped/u);
    });

    it("clones everything else in parallel and leaves no partial clone", () => {
      for (let index = 0; index < 12; index += 1) {
        const dir = path.join(
          root,
          index % 2 === 0 ? "backend" : "frontend",
          `${index % 2 === 0 ? "api" : "web"}-${index}`,
        );

        expect(existsSync(path.join(dir, ".git"))).toBeTruthy();
      }

      expect(existsSync(path.join(root, "backend/ghost"))).toBeFalsy();
      expect(existsSync(path.join(root, "backend/.ghost.overrepo-partial"))).toBeFalsy();
    });

    it("reports existing clones as present", () => {
      expect(again.code).toBe(0);
      expect(actionsOf(again)).toStrictEqual(["present", "present"]);
    });
  });

  it("--pull fast-forwards existing clones", async () => {
    const { root, remotes } = setupWorkspace(2);
    const first = await cli(root, ["sync"]);
    expect(first.code).toBe(0);
    const source = path.join(remotes, "api-0.git-src");
    writeFileSync(path.join(source, "NEW.md"), "new\n");
    git(source, "add", "-A");
    git(source, "commit", "-q", "-m", "second");

    const result = await cli(root, ["sync", "--pull", "--json"]);
    expect(result.code).toBe(0);
    expect(parseJson(syncJson, result.stdout).results[0]).toMatchObject({
      path: "backend/api-0",
      action: "pulled",
    });
    expect(existsSync(path.join(root, "backend/api-0/NEW.md"))).toBeTruthy();
  });

  it("--dry-run touches nothing", async () => {
    const { root } = setupWorkspace(2);
    const result = await cli(root, ["sync", "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/would clone/u);
    expect(existsSync(path.join(root, "backend"))).toBeFalsy();
  });
});

describe("init", () => {
  describe("from clones, some without an origin", () => {
    let init: TestRun;
    let text: string;
    let list: TestRun;
    let sync: TestRun;
    let rerun: TestRun;

    beforeAll(async () => {
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

      init = await cli(fresh, ["init"]);
      text = readFileSync(path.join(fresh, "overrepo.yaml"), "utf-8");
      list = await cli(fresh, ["list", "--json"]);
      sync = await cli(fresh, ["sync", "--json"]);
      rerun = await cli(fresh, ["init"]);
    });

    it("builds a manifest from the clones that have an origin", () => {
      expect(init.code).toBe(0);
      expect(init.stderr).toMatch(/2 project/u);
      expect(init.stderr).toMatch(/tools\/local: no "origin" remote, skipped/u);
      expect(text).toMatch(
        /backend\/api-0:\n {4}url: .+\n {4}desc: Project 0\n {4}tags: \[ backend \]/u,
      );
      expect(text).not.toContain("tools/local");
    });

    it("writes a manifest that list and sync use as is", () => {
      expect(parseJson(listJson, list.stdout).map((project) => project.path)).toStrictEqual([
        "backend/api-0",
        "frontend/web-1",
      ]);
      expect(sync.code).toBe(0);
      expect(actionsOf(sync)).toStrictEqual(["present", "present"]);
    });

    it("refuses to overwrite an existing manifest", () => {
      expect(rerun.code).toBe(2);
    });
  });

  it("follows directory symlinks and skips the scan root", async () => {
    const hub = tempDir("overrepo-scan-");
    git(hub, "init", "-q");
    const real = tempDir("overrepo-real-");
    writeFileSync(path.join(real, "README.md"), "# collect\n");
    git(real, "init", "-q");
    git(real, "add", "-A");
    git(real, "commit", "-q", "-m", "init");
    git(real, "remote", "add", "origin", "file:///collect.git");
    mkdirSync(path.join(hub, "acme"), { recursive: true });
    symlinkSync(real, path.join(hub, "acme", "collect"), "dir");
    const named = path.join(hub, "t3-abc");
    mkdirSync(named, { recursive: true });
    git(named, "init", "-q");
    git(named, "remote", "add", "origin", "file:///t3-abc.git");

    const init = await cli(hub, ["init", "--dry-run"]);
    expect(init.code).toBe(0);
    expect(init.stdout).toContain("acme/collect:");
    expect(init.stdout).toContain("url: file:///collect.git");
    expect(init.stdout).toContain("t3-abc:");
    expect(init.stdout).not.toMatch(/^ {2}\.:/mu);
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
    expect(result.stderr).toMatch(/no projects selected/u);
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

    const entries = parseJson(
      z.array(z.object({ name: z.string(), stdout: z.string() })),
      result.stdout,
    );

    expect(entries.map((entry) => entry.name)).toStrictEqual(["backend/api-0", "backend/api-2"]);
    expect(entries[0]?.stdout).toBe("?? dirty.txt");
  });

  it("prefixes parallel output and reports failures with exit code 1", async () => {
    const result = await cli(root, [
      "exec",
      "--all",
      "-j",
      "4",
      "--",
      process.execPath,
      "-e",
      "console.log('hi'); if (process.env.OVERREPO_PROJECT === 'frontend/web-3') process.exit(1)",
    ]);

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^backend\/api-0 +│ hi$/mu);
    expect(result.stderr).toMatch(/frontend\/web-3 .*exit code 1/u);
    expect(result.stderr).toMatch(/3 ok, 1 failed, 0 skipped/u);
  });

  it("reports aggregated status", async () => {
    const result = await cli(root, ["status", "--json"]);
    expect(result.code).toBe(0);

    const entries = parseJson(
      z.array(
        z.object({
          name: z.string(),
          state: z.string(),
          branch: z.string().nullable().optional(),
          upstream: z.string().nullable().optional(),
          ahead: z.number().optional(),
          behind: z.number().optional(),
          dirty: z.boolean().optional(),
        }),
      ),
      result.stdout,
    );

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
  let hub: string;
  let synced: TestRun;
  let listed: TestRun;
  let doctor: TestRun;

  beforeAll(async () => {
    hub = tempDir("overrepo-hub-");
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
        "  acme/collect/collect:",
        `    url: ${url}`,
        "    tags: [collect]",
        "",
      ].join("\n"),
    );

    const args = ["-c", "workspace/overrepo.yaml"];
    synced = await cli(hub, [...args, "sync", "--tags", "collect"]);
    listed = await cli(hub, [...args, "list", "--json"]);
    doctor = await cli(hub, [...args, "doctor", "--no-network", "--json"]);
  });

  it("clones beside the manifest and does not write a gitignore", () => {
    expect(synced.code).toBe(0);
    expect(existsSync(path.join(hub, "acme/collect/collect/README.md"))).toBeTruthy();
    expect(existsSync(path.join(hub, ".gitignore"))).toBeFalsy();
  });

  it("lists and checks projects relative to the fleet root", () => {
    expect(parseJson(listJson, listed.stdout).map((project) => project.path)).toStrictEqual([
      "acme/collect/collect",
    ]);
    expect(doctor.code).toBe(0);
    const { checks } = parseJson(doctorJson, doctor.stdout);
    expect(checks.find((check) => check.id === "orphans")).toMatchObject({ level: "ok" });
  });
});

describe("context", () => {
  interface ContextScenario {
    synced: TestRun;
    generated: TestRun;
    indexExists: boolean;
    text: string;
    sha: string;
    committed: string;
    analysis: Analysis;
    again: TestRun;
    check: TestRun;
    checkAfterEdit: TestRun;
    editedCard: string;
    exec: TestRun;
  }

  let scenario: ContextScenario;

  beforeAll(async () => {
    const hub = tempDir("overrepo-summary-");
    const workspace = path.join(hub, "workspace");
    mkdirSync(workspace, { recursive: true });

    const url = createRemote(tempDir("overrepo-summary-remotes-"), "collect", {
      "README.md": "# collect\n\ncommitted body\n",
      "package.json": JSON.stringify({
        name: "collect",
        scripts: { test: "echo ok" },
        engines: { node: ">=20" },
        packageManager: "pnpm@10.4.1+sha512.abcdef",
      }),
      ".nvmrc": "20.11.0\n",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });

    writeFileSync(
      path.join(workspace, "overrepo.yaml"),
      [
        "root: ..",
        "summary:",
        "  outDir: aidd_docs/memory/internal",
        "projects:",
        "  acme/collect/collect:",
        `    url: ${url}`,
        "    tags: [collect]",
        "    desc: Collect",
        "",
      ].join("\n"),
    );
    const args = ["-c", "workspace/overrepo.yaml"];
    const synced = await cli(hub, [...args, "sync", "--tags", "collect"]);
    const clone = path.join(hub, "acme/collect/collect");
    writeFileSync(path.join(clone, "README.md"), "# collect\n\nDIRTY body\n");
    writeFileSync(path.join(clone, ".nvmrc"), "16\n");
    const sha = git(clone, "rev-parse", "origin/HEAD");

    const committed = new Date(
      git(clone, "log", "-1", "--format=%cI", "origin/HEAD"),
    ).toISOString();

    const generated = await cli(hub, [...args, "context"]);
    const card = path.join(workspace, "aidd_docs/memory/internal/acme/collect/collect.md");
    const index = path.join(workspace, "aidd_docs/memory/internal/index.md");
    const indexExists = existsSync(index);
    const text = readFileSync(card, "utf-8");

    const analysis = await analyzeProject(
      { name: "collect", path: "collect", dir: clone, url, desc: undefined, tags: [] },
      [],
    );

    const again = await cli(hub, [...args, "context", "--json"]);
    const check = await cli(hub, [...args, "context", "--check"]);
    writeFileSync(card, text.replace("Collect", "Changed"));
    const checkAfterEdit = await cli(hub, [...args, "context", "--check"]);
    const editedCard = readFileSync(card, "utf-8");

    const exec = await cli(hub, [
      ...args,
      "exec",
      "--tags",
      "collect",
      "--",
      "git",
      "status",
      "-s",
    ]);

    scenario = {
      synced,
      generated,
      indexExists,
      text,
      sha,
      committed,
      analysis,
      again,
      check,
      checkAfterEdit,
      editedCard,
      exec,
    };
  });

  it("writes summaries from origin/HEAD next to the manifest and ignores a dirty tree", () => {
    expect(scenario.synced.code).toBe(0);
    expect(scenario.generated.code).toBe(0);
    expect(scenario.indexExists).toBeTruthy();
    expect(scenario.text).toContain("committed body");
    expect(scenario.text).not.toContain("DIRTY");
  });

  it("puts the description, last commit, package managers and runtimes in the card", () => {
    const { text, sha, committed } = scenario;
    expect(text).toContain("Collect");
    expect(text).toContain(
      `- **Last commit:** ${committed.slice(0, 10)} (\`${sha.slice(0, 7)}\` on \`origin/HEAD\`)`,
    );
    expect(text).toContain("- **Package managers:** pnpm 10.4.1");
    expect(text).toContain("- **Runtimes:** Node >=20, Node 20.11.0 (.nvmrc)");
  });

  it("analyzes origin/HEAD", () => {
    const { analysis, sha, committed } = scenario;
    expect(analysis.lastCommit).toStrictEqual({ sha, shortSha: sha.slice(0, 7), date: committed });
    expect(analysis.runtimeVersions).toStrictEqual([
      { name: "node", version: ">=20", source: "package.json#engines.node" },
      { name: "node", version: "20.11.0", source: ".nvmrc" },
    ]);
    expect(analysis.packageManagerVersions).toStrictEqual([
      { name: "pnpm", version: "10.4.1", source: "package.json#packageManager" },
    ]);
  });

  it("leaves up-to-date cards unchanged and reports edited ones as stale", () => {
    const { files } = parseJson(
      z.object({ files: z.array(z.object({ status: z.string() })) }),
      scenario.again.stdout,
    );

    expect(scenario.again.code).toBe(0);
    expect(files.every((file) => file.status === "unchanged")).toBeTruthy();
    expect(scenario.check.code).toBe(0);
    expect(scenario.checkAfterEdit.code).toBe(1);
    expect(scenario.editedCard).toContain("Changed");
  });

  it("keeps the clone clean for other commands", () => {
    expect(scenario.exec.code).toBe(0);
  });
});

describe("import", () => {
  describe("into a manifest with comments", () => {
    let result: TestRun;
    let text: string;
    let pruned: TestRun;
    let afterPrune: string;
    let invalid: TestRun[];

    beforeAll(async () => {
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

      result = await cli(root, ["import", "--json"], input);
      text = readFileSync(path.join(root, "overrepo.yaml"), "utf-8");
      pruned = await cli(root, ["import", "--prune"], input);
      afterPrune = readFileSync(path.join(root, "overrepo.yaml"), "utf-8");

      invalid = [
        await cli(root, ["import"], "{nope"),
        await cli(
          root,
          ["import"],
          JSON.stringify([{ name: "bad", path: "other", url: "https://example.com/a.git" }]),
        ),
        await cli(
          root,
          ["import"],
          JSON.stringify([{ name: "../x", url: "https://example.com/x.git" }]),
        ),
      ];
    });

    it("adds, updates and reports missing projects", () => {
      expect(result.code).toBe(0);
      expect(
        parseJson(
          z.object({
            added: z.array(z.string()),
            updated: z.record(z.string(), z.array(z.string())),
            missing: z.array(z.string()),
            removed: z.array(z.string()),
          }),
          result.stdout,
        ),
      ).toMatchObject({
        added: ["frontend/web"],
        updated: { "backend/api": ["desc", "tags"] },
        missing: ["old"],
        removed: [],
      });
    });

    it("keeps comments", () => {
      expect(text).toContain("# header comment");
      expect(text).toContain("  # the API\n  backend/api:");
      expect(text).toContain("    tags: [ backend ]");
      expect(text).toContain("  frontend/web:\n    url: git@github.com:client/web.git");
    });

    it("removes missing projects with --prune", () => {
      expect(pruned.code).toBe(0);
      expect(afterPrune).not.toContain("old:");
    });

    it("rejects invalid JSON, a path that differs from the name and a path outside the root", () => {
      expect(invalid.map((run) => run.code)).toStrictEqual([2, 2, 2]);
    });
  });

  describe("into an empty flow map", () => {
    let root: string;
    let imported: TestRun;
    let text: string;
    let synced: TestRun;

    beforeAll(async () => {
      root = tempDir("overrepo-import-flow-");
      const remotes = tempDir("overrepo-import-remotes-");
      const oldUrl = createRemote(remotes, "old");
      const webUrl = createRemote(remotes, "web");
      writeFileSync(path.join(root, "overrepo.yaml"), "projects: {}\n");

      imported = await cli(
        root,
        ["import"],
        JSON.stringify({
          projects: [
            { name: "frontend/web", url: webUrl, tags: ["frontend", "node"] },
            { name: "libraries/lib", url: "https://example.com/lib.git", tags: ["libraries"] },
          ],
        }),
      );

      text = readFileSync(path.join(root, "overrepo.yaml"), "utf-8");
      writeFileSync(path.join(root, "overrepo.yaml"), `projects:\n  old:\n    url: ${oldUrl}\n`);

      synced = await cli(
        root,
        ["import", "--sync", "--json"],
        JSON.stringify({ projects: [{ name: "frontend/web", url: webUrl }] }),
      );
    });

    it("writes projects as a block map", () => {
      expect(imported.code).toBe(0);
      expect(text).toMatch(/projects:\n {2}frontend\/web:/u);
      expect(text).toContain("tags: [ frontend, node ]");
      expect(text.split("\n").length).toBeGreaterThan(6);
    });

    it("clones only what it added", () => {
      expect(synced.code).toBe(0);
      expect(existsSync(path.join(root, "frontend/web/README.md"))).toBeTruthy();
      expect(existsSync(path.join(root, "old"))).toBeFalsy();
    });
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

    const { checks } = parseJson(doctorJson, result.stdout);

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
    const doctor = await cli(root, ["doctor", "--no-network"]);
    expect(doctor.code).toBe(2);
    const list = await cli(root, ["list"]);
    expect(list.code).toBe(2);
    expect(list.stderr).toMatch(/escapes the fleet root/u);
  });
});

describe(cli, () => {
  it("prints help", async () => {
    const help = await cli(tempDir(), ["--help"]);
    expect(help.stdout).toContain("Usage: overrepo");
    expect(help.stdout).toContain("sync");
    expect(help.stdout).toMatch(/\bcontext\b/u);
    expect(help.stdout).not.toMatch(/\n {2}run\b/u);
  });

  it("prints the version and fails without a manifest", async () => {
    const version = await cli(tempDir(), ["--version"]);
    const list = await cli(tempDir(), ["list"]);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+/u);
    expect(list.code).toBe(2);
  });
});
