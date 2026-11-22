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

/**
 * Turns a README into a bounded excerpt that nests under a `##` heading:
 * drops front matter, HTML comments, badges and the title, demotes headings,
 * and cuts at a line boundary without leaving a code fence open
 */
export const readmeExcerpt = (
  readme: string,
  maxChars: number,
): { text: string; truncated: boolean } => {
  if (maxChars <= 0) {
    return { text: "", truncated: readme.trim() !== "" };
  }

  let text = readme.replaceAll("\r\n", "\n").replace(/^﻿/u, "");
  text = text.replace(/^---\n[\s\S]*?\n---\n/u, "");
  text = text.replaceAll(/<!--[\s\S]*?-->/gu, "");

  const lines: string[] = [];
  let fence: string | undefined;
  let titleDropped = false;

  for (const line of text.split("\n")) {
    const marker = /^\s*(?<marker>`{3,}|~{3,})/u.exec(line)?.groups?.marker;

    if (marker !== undefined && marker !== "") {
      if (fence === undefined) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }

      lines.push(line);
      continue;
    }

    if (fence !== undefined) {
      lines.push(line);
      continue;
    }

    if (/^\s*(?:\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)\s*|!\[[^\]]*\]\([^)]*\)\s*)+$/u.test(line)) {
      continue;
    }

    // Lines made only of HTML tags (logos, badge rows, alignment wrappers) carry no text for an agent
    if (line.includes("<") && line.replaceAll(/<[^>]*>/gu, "").trim() === "") {
      continue;
    }

    const heading = /^(?<level>#{1,6})\s+(?<title>.*)$/u.exec(line)?.groups;

    if (heading) {
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
      continue;
    }

    lines.push(line);
  }

  const cleaned = neutralizeMarkers(lines.join("\n"))
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();

  if (cleaned.length <= maxChars) {
    return { text: cleaned, truncated: false };
  }

  const kept: string[] = [];
  let size = 0;
  let open: string | undefined;

  for (const line of cleaned.split("\n")) {
    if (size + line.length + 1 > maxChars) {
      break;
    }

    kept.push(line);
    size += line.length + 1;
    const marker = /^\s*(?<marker>`{3,}|~{3,})/u.exec(line)?.groups?.marker;

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

  return { text: kept.join("\n"), truncated: true };
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
