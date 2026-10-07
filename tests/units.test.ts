import { describe, expect, it } from "vite-plus/test";
import { parseManifest } from "../src/core/manifest.ts";
import { selectProjects } from "../src/core/selection.ts";
import { normalizeGitUrl } from "../src/core/urls.ts";
import { parseStatus } from "../src/git/git.ts";

describe("selectProjects", () => {
  const { projects } = parseManifest(
    `
projects:
  backend/api: { url: https://example.com/api.git, tags: [backend, node] }
  backend/billing: { url: https://example.com/billing.git, tags: [backend, php] }
  frontend/web: { url: https://example.com/web.git, tags: [frontend, node] }
  backend/legacy: { url: https://example.com/legacy.git, tags: [backend, deprecated] }
`,
    "/m/overrepo.yaml",
  );
  const names = (selection: Parameters<typeof selectProjects>[1], requireExplicit = false) =>
    selectProjects(projects, selection, { requireExplicit }).map((project) => project.name);

  it("returns everything without selection, unless an explicit one is required", () => {
    expect(names({})).toEqual(["backend/api", "backend/billing", "frontend/web", "backend/legacy"]);
    expect(() => names({}, true)).toThrow(/no projects selected/);
  });

  it("requires every tag", () => {
    expect(names({ tags: ["backend", "node"] })).toEqual(["backend/api"]);
  });

  it("filters by path prefix on segment boundaries", () => {
    expect(names({ paths: ["backend/"] })).toEqual([
      "backend/api",
      "backend/billing",
      "backend/legacy",
    ]);
    expect(names({ paths: ["back"] })).toEqual([]);
    expect(names({ paths: ["frontend/web"] })).toEqual(["frontend/web"]);
  });

  it("selects by path and rejects unknown paths", () => {
    expect(names({ projects: ["frontend/web", "backend/api"] })).toEqual([
      "backend/api",
      "frontend/web",
    ]);
    expect(() => names({ projects: ["nope"] })).toThrow(/unknown project: nope/);
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
