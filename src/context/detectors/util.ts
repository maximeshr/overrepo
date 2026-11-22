import { isObject, isString } from "../../core/json.ts";
import type { JsonValue } from "../../core/json.ts";

/** Returns the labels whose key is present, in table order, without duplicates */
export const known = (
  present: (key: string) => boolean,
  table: readonly (readonly [string, string])[],
): string[] => {
  const labels: string[] = [];

  for (const [key, label] of table) {
    if (present(key) && !labels.includes(label)) {
      labels.push(label);
    }
  }

  return labels;
};

/** The string entries of an object, none for any other value */
export const stringRecord = (value: JsonValue | undefined): Record<string, string> => {
  if (!isObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => isString(entry[1])),
  );
};
