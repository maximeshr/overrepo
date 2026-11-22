/** A value read from a JSON or YAML file */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/** An object read from a JSON or YAML file */
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/** Plain objects. Only parsed JSON and YAML are checked, whose values are JSON values */
export const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Objects among the values of a JSON object */
export const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isString = (value: unknown): value is string => typeof value === "string";
