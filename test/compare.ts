// Checks that the TypeScript parser produces the same JSON as the Haskell
// CLI. Usage: node test/compare.ts REPLAY HASKELL_JSON [REPLAY HASKELL_JSON ...]

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseReplay } from "../src/parser/replay.ts";

function load(path: string): Uint8Array {
  const b = readFileSync(path);
  return b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b;
}

// Haskell prints Float values with the shortest float32 digits, JavaScript
// with float64 digits, so numbers are compared with a relative tolerance.
function diff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (out.length >= 10) return;
  if (typeof a === "number" && typeof b === "number") {
    if (a !== b && Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))) out.push(`${path}: ${a} != ${b}`);
    return;
  }
  // aeson encodes non-finite floats as null.
  if (typeof a === "number" && !Number.isFinite(a) && b === null) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} != ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) out.push(`${path}: keys ${ka} != ${kb}`);
    for (const k of ka) {
      if (k === "error") continue;
      if (k in b) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
    return;
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

const args = process.argv.slice(2);
let failed = 0;
for (let i = 0; i + 1 < args.length; i += 2) {
  const t0 = performance.now();
  const ours = JSON.parse(JSON.stringify(parseReplay(load(args[i]))));
  const ms = (performance.now() - t0).toFixed(0);
  const theirs = JSON.parse(readFileSync(args[i + 1], "utf8"));
  const out: string[] = [];
  diff(ours, theirs, "$", out);
  if (out.length) {
    failed++;
    console.log(`FAIL ${args[i]}\n  ${out.join("\n  ")}`);
  } else {
    console.log(`ok   ${args[i]} (${ms} ms)`);
  }
}
process.exit(failed ? 1 : 0);
