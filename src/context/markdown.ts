const MANUAL_BEGIN = "<!-- overrepo:manual -->";
const MANUAL_END = "<!-- /overrepo:manual -->";

const DEFAULT_MANUAL_BODY =
  "<!-- Human notes go here: this block is kept as-is when the file is regenerated. -->";

/** Inline code span that survives backticks in the content */
export const code = (text: string): string => {
  const longest = Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";

  return `${fence}${pad}${text}${pad}${fence}`;
};

/** Makes a value safe for a single Markdown table cell */
export const tableCell = (text: string): string =>
  text.replaceAll(/\r?\n/gu, " ").replaceAll("|", "\\|").trim();

export const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

/** Link target for a relative path (spaces and parentheses would break Markdown links) */
export const linkTarget = (relative: string): string =>
  relative
    .split("/")
    .map((segment) => encodeURIComponent(segment).replaceAll(/%2E/giu, "."))
    .join("/");

/** Neutralizes overrepo markers inside copied content so they cannot be mistaken for real ones */
const neutralizeMarkers = (text: string): string =>
  text.replaceAll("overrepo:manual", "overrepo-manual");

/** A README excerpt, and whether it was cut to fit */
interface Excerpt {
  text: string;
  truncated: boolean;
}

const FENCE = /^\s*(?<marker>`{3,}|~{3,})/u;
const BADGE_ROW = /^\s*(?:\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)\s*|!\[[^\]]*\]\([^)]*\)\s*)+$/u;
const HEADING = /^(?<level>#{1,6})\s+(?<title>.*)$/u;

/** Badge rows and lines made only of HTML tags (logos, alignment wrappers) carry no text for an agent */
const isDecoration = (line: string): boolean =>
  BADGE_ROW.test(line) || (line.includes("<") && line.replaceAll(/<[^>]*>/gu, "").trim() === "");

/** Drops front matter, HTML comments, decorations and the title, and demotes headings */
const cleanReadme = (readme: string): string => {
  let text = readme.replaceAll("\r\n", "\n").replace(/^\uFEFF/u, "");
  text = text.replace(/^---\n[\s\S]*?\n---\n/u, "");
  text = text.replaceAll(/<!--[\s\S]*?-->/gu, "");

  const lines: string[] = [];
  let fence: string | undefined;
  let titleDropped = false;

  for (const line of text.split("\n")) {
    const marker = FENCE.exec(line)?.groups?.marker;

    if (marker !== undefined && marker !== "") {
      if (fence === undefined) {
        fence = marker;
      } else if (marker.startsWith(fence.charAt(0)) && marker.length >= fence.length) {
        fence = undefined;
      }

      lines.push(line);
      continue;
    }

    if (fence !== undefined) {
      lines.push(line);
      continue;
    }

    if (isDecoration(line)) {
      continue;
    }

    const heading = HEADING.exec(line)?.groups;

    if (!heading) {
      lines.push(line);
      continue;
    }

    if (
      !titleDropped &&
      heading.level === "#" &&
      lines.every((previous) => previous.trim() === "")
    ) {
      titleDropped = true;
      continue;
    }

    lines.push(
      `${"#".repeat(Math.min(6, (heading.level ?? "#").length + 2))} ${heading.title ?? ""}`,
    );
  }

  return neutralizeMarkers(lines.join("\n"))
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
};

/** Cuts at a line boundary, closing a code fence left open */
const cutAtLine = (text: string, maxChars: number): string => {
  const kept: string[] = [];
  let size = 0;
  let open: string | undefined;

  for (const line of text.split("\n")) {
    if (size + line.length + 1 > maxChars) {
      break;
    }

    kept.push(line);
    size += line.length + 1;
    const marker = FENCE.exec(line)?.groups?.marker;

    if (marker !== undefined && marker !== "") {
      open = open === undefined ? marker : undefined;
    }
  }

  if (open !== undefined) {
    kept.push(open);
  }

  // Drop trailing blank lines and headings left without their content
  while (kept.length > 0 && /^(?:\s*|#{1,6}\s.*)$/u.test(kept.at(-1) ?? "")) {
    kept.pop();
  }

  return kept.join("\n");
};

/**
 * Turns a README into a bounded excerpt that nests under a `##` heading:
 * drops front matter, HTML comments, badges and the title, demotes headings,
 * and cuts at a line boundary without leaving a code fence open
 */
export const readmeExcerpt = (readme: string, maxChars: number): Excerpt => {
  if (maxChars <= 0) {
    return { text: "", truncated: readme.trim() !== "" };
  }

  const cleaned = cleanReadme(readme);

  if (cleaned.length <= maxChars) {
    return { text: cleaned, truncated: false };
  }

  return { text: cutAtLine(cleaned, maxChars), truncated: true };
};

/** Extracts the inner content of the manual block, if any */
export const extractManual = (content: string): string | undefined => {
  const begin = content.indexOf(MANUAL_BEGIN);

  if (begin === -1) {
    return undefined;
  }

  const end = content.indexOf(MANUAL_END, begin + MANUAL_BEGIN.length);

  if (end === -1) {
    return undefined;
  }

  return content
    .slice(begin + MANUAL_BEGIN.length, end)
    .replace(/^\n/u, "")
    .replace(/\n$/u, "");
};

export const manualBlock = (body: string | undefined): string =>
  [MANUAL_BEGIN, body ?? DEFAULT_MANUAL_BODY, MANUAL_END].join("\n");
