---
"overrepo": minor
---

Custom detectors passed to `analyzeProject` now run concurrently instead of one after the other; results keep the same order. A detector that relies on another one having finished first must now do its own sequencing.

The exported functions are now declared as `const` arrow functions in the type declarations (`export declare const sync: (...) => ...`). Calls and imports compile unchanged; only calling them with `new` or merging a namespace into them stops working.

Project colors now hash names by code point: a project whose name contains characters outside the Basic Multilingual Plane, such as an emoji, may get a different color.
