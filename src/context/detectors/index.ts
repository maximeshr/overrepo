import type { Detector } from "../types.ts";
import { dockerDetector } from "./docker.ts";
import { goDetector } from "./go.ts";
import { makeDetector } from "./make.ts";
import { ciDetector, dotnetDetector, jvmDetector, rubyDetector, rustDetector } from "./misc.ts";
import { nodeDetector } from "./node.ts";
import { phpDetector } from "./php.ts";
import { pythonDetector } from "./python.ts";

/** Order matters: it drives the order of languages, frameworks and scripts in cards. */
export const defaultDetectors: Detector[] = [
  nodeDetector,
  phpDetector,
  goDetector,
  pythonDetector,
  rustDetector,
  jvmDetector,
  rubyDetector,
  dotnetDetector,
  dockerDetector,
  makeDetector,
  ciDetector,
];
