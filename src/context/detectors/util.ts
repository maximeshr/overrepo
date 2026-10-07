/** Returns the labels whose key is present, in table order, without duplicates. */
export function known(
  present: (key: string) => boolean,
  table: ReadonlyArray<readonly [string, string]>,
): string[] {
  const labels: string[] = [];
  for (const [key, label] of table) if (present(key) && !labels.includes(label)) labels.push(label);
  return labels;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
