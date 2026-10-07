import { describe, expect, it } from "vite-plus/test";
import { extractManual, manualBlock, readmeExcerpt } from "../src/context/markdown.ts";
import { GITIGNORE_BEGIN, GITIGNORE_END, updateGitignoreContent } from "../src/core/gitignore.ts";
import { parseManifest } from "../src/core/manifest.ts";
import { selectProjects } from "../src/core/selection.ts";
import { normalizeGitUrl } from "../src/core/urls.ts";
import { parseStatus } from "../src/git/git.ts";

describe("selectProjects", () => {
  const { projects } = parseManifest(
    `
projects:
  api: { path: backend/api, tags: [backend, node] }
  billing: { path: backend/billing, tags: [backend, php] }
  web: { path: frontend/web, tags: [frontend, node] }
  legacy: { path: backend/legacy, tags: [backend, deprecated] }
`,
    "/m/overrepo.yaml",
  );
  const names = (selection: Parameters<typeof selectProjects>[1], requireExplicit = false) =>
    selectProjects(projects, selection, { requireExplicit }).map((project) => project.name);

  it("returns everything without selection, unless an explicit one is required", () => {
    expect(names({})).toEqual(["api", "billing", "web", "legacy"]);
    expect(() => names({}, true)).toThrow(/no projects selected/);
    expect(() => names({ excludeTags: ["php"] }, true)).toThrow(/no projects selected/);
  });

  it("combines tags with AND, tags-any with OR", () => {
    expect(names({ tags: ["backend", "node"] })).toEqual(["api"]);
    expect(names({ tagsAny: ["php", "frontend"] })).toEqual(["billing", "web"]);
  });

  it("filters by path prefix on segment boundaries", () => {
    expect(names({ paths: ["backend/"] })).toEqual(["api", "billing", "legacy"]);
    expect(names({ paths: ["back"] })).toEqual([]);
    expect(names({ paths: ["frontend/web"] })).toEqual(["web"]);
  });

  it("selects by name and rejects unknown names", () => {
    expect(names({ projects: ["web", "api"] })).toEqual(["api", "web"]);
    expect(() => names({ projects: ["nope"] })).toThrow(/unknown project: nope/);
  });

  it("applies exclusions last", () => {
    expect(names({ all: true, excludeTags: ["deprecated", "php"] })).toEqual(["api", "web"]);
  });
});

describe("gitignore block", () => {
  it("appends the block and keeps the rest intact", () => {
    const next = updateGitignoreContent("node_modules\n# mine\n", ["b/x", "a/y"]);
    expect(next).toBe(
      `node_modules\n# mine\n\n${GITIGNORE_BEGIN}\n/a/y/\n/b/x/\n.*.overrepo-partial/\n${GITIGNORE_END}\n`,
    );
  });

  it("only rewrites the managed block", () => {
    const before = `top\n${GITIGNORE_BEGIN}\n/old/\n${GITIGNORE_END}\nbottom`;
    expect(updateGitignoreContent(before, ["new"])).toBe(
      `top\n${GITIGNORE_BEGIN}\n/new/\n.*.overrepo-partial/\n${GITIGNORE_END}\nbottom`,
    );
  });

  it("is idempotent and keeps CRLF files in CRLF", () => {
    const once = updateGitignoreContent("a\r\n", ["x"]);
    expect(updateGitignoreContent(once, ["x"])).toBe(once);
    expect(once).toContain(`${GITIGNORE_BEGIN}\r\n/x/\r\n`);
  });

  it("escapes glob characters", () => {
    expect(updateGitignoreContent("", ["a[1]"])).toContain("/a\\[1\\]/");
  });
});

describe("normalizeGitUrl", () => {
  it.each([
    ["git@github.com:Client/Repo.git", "github.com/client/repo"],
    ["https://github.com/client/repo", "github.com/client/repo"],
    ["ssh://git@github.com/client/repo.git", "github.com/client/repo"],
    ["git+ssh://git@github.com/client/repo.git#v1.2.0", "github.com/client/repo"],
    ["github:client/repo", "github.com/client/repo"],
    ["https://gitlab.example.com/group/sub/repo.git/", "gitlab.example.com/group/sub/repo"],
  ])("%s", (input, expected) => {
    expect(normalizeGitUrl(input)).toBe(expected);
  });

  it("ignores version ranges", () => {
    expect(normalizeGitUrl("^1.2.3")).toBeUndefined();
  });
});

describe("parseStatus", () => {
  it("parses porcelain v2 output", () => {
    const status = parseStatus(
      [
        "# branch.oid 1234567890abcdef",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +2 -1",
        "1 .M N... 100644 100644 100644 a b file",
        "? new",
      ].join("\n"),
    );
    expect(status).toEqual({
      branch: "main",
      head: "1234567",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      changes: 2,
    });
  });

  it("handles detached and empty repositories", () => {
    expect(parseStatus("# branch.oid (initial)\n# branch.head (detached)\n")).toMatchObject({
      branch: undefined,
      head: undefined,
    });
  });
});

describe("markdown helpers", () => {
  it("extracts and re-renders the manual block", () => {
    const block = manualBlock("my notes\n- keep me");
    expect(extractManual(`# x\n\n${block}\n`)).toBe("my notes\n- keep me");
    expect(extractManual("no block")).toBeUndefined();
  });

  it("builds a bounded README excerpt", () => {
    const readme = [
      "# Title",
      "[![build](https://x/badge.svg)](https://x)",
      "<!-- hidden -->",
      "Intro text.",
      "## Install",
      "```sh",
      "# not a heading",
      "npm i",
      "```",
      "<!-- overrepo:manual -->",
    ].join("\n");
    const { text, truncated } = readmeExcerpt(readme, 1000);
    expect(truncated).toBe(false);
    expect(text).toBe("Intro text.\n#### Install\n```sh\n# not a heading\nnpm i\n```");
  });

  it("drops HTML-only lines and headings orphaned by truncation", () => {
    const readme = [
      '<p align="center"><a href="x"><img src="logo.svg"></a></p>',
      '<a href="ci"><img src="badge.svg" alt="Build"></a>',
      "Intro <b>bold</b> text.",
      "",
      "## Next section",
      "x".repeat(200),
    ].join("\n");
    const { text, truncated } = readmeExcerpt(readme, 60);
    expect(truncated).toBe(true);
    expect(text).toBe("Intro <b>bold</b> text.");
  });

  it("never leaves a code fence open when truncating", () => {
    const readme = `Intro\n\n\`\`\`\n${"line\n".repeat(50)}\`\`\`\n`;
    const { text, truncated } = readmeExcerpt(readme, 60);
    expect(truncated).toBe(true);
    expect((text.match(/```/g) ?? []).length % 2).toBe(0);
  });
});
