export const MANUAL_BEGIN = "<!-- overrepo:manual -->";
export const MANUAL_END = "<!-- /overrepo:manual -->";
export const DEFAULT_MANUAL_BODY =
  "<!-- Human notes go here: this block is kept as-is when the file is regenerated. -->";

/** Inline code span that survives backticks in the content. */
export function code(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Makes a value safe for a single Markdown table cell. */
export function tableCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Link target for a relative path (spaces and parentheses would break Markdown links). */
export function linkTarget(relative: string): string {
  return relative
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%2E/gi, "."))
    .join("/");
}

/** Neutralizes overrepo markers inside copied content so they cannot be mistaken for real ones. */
export function neutralizeMarkers(text: string): string {
  return text.replaceAll("overrepo:manual", "overrepo-manual");
}

/**
 * Turns a README into a bounded excerpt that nests under a `##` heading:
 * drops front matter, HTML comments, badges and the title, demotes headings,
 * and cuts at a line boundary without leaving a code fence open.
 */
export function readmeExcerpt(
  readme: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0) return { text: "", truncated: readme.trim() !== "" };
  let text = readme.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  text = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  const lines: string[] = [];
  let fence: string | undefined;
  let titleDropped = false;
  for (const line of text.split("\n")) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      lines.push(line);
      continue;
    }
    if (fence !== undefined) {
      lines.push(line);
      continue;
    }
    if (/^\s*(\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)\s*|!\[[^\]]*\]\([^)]*\)\s*)+$/.test(line)) continue;
    // Lines made only of HTML tags (logos, badge rows, alignment wrappers) carry no text for an agent.
    if (line.includes("<") && line.replace(/<[^>]*>/g, "").trim() === "") continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      if (
        !titleDropped &&
        heading[1] === "#" &&
        lines.every((previous) => previous.trim() === "")
      ) {
        titleDropped = true;
        continue;
      }
      lines.push(`${"#".repeat(Math.min(6, (heading[1] ?? "#").length + 2))} ${heading[2] ?? ""}`);
      continue;
    }
    lines.push(line);
  }

  const cleaned = neutralizeMarkers(lines.join("\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= maxChars) return { text: cleaned, truncated: false };

  const kept: string[] = [];
  let size = 0;
  let open: string | undefined;
  for (const line of cleaned.split("\n")) {
    if (size + line.length + 1 > maxChars) break;
    kept.push(line);
    size += line.length + 1;
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) open = open === undefined ? marker : undefined;
  }
  if (open !== undefined) kept.push(open);
  // Drop trailing blank lines and headings left without their content.
  while (kept.length > 0 && /^(\s*|#{1,6}\s.*)$/.test(kept.at(-1) ?? "")) kept.pop();
  return { text: kept.join("\n"), truncated: true };
}

/** Extracts the inner content of the manual block, if any. */
export function extractManual(content: string): string | undefined {
  const begin = content.indexOf(MANUAL_BEGIN);
  if (begin === -1) return undefined;
  const end = content.indexOf(MANUAL_END, begin + MANUAL_BEGIN.length);
  if (end === -1) return undefined;
  return content
    .slice(begin + MANUAL_BEGIN.length, end)
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}

export function manualBlock(body: string | undefined): string {
  return [MANUAL_BEGIN, body ?? DEFAULT_MANUAL_BODY, MANUAL_END].join("\n");
}
