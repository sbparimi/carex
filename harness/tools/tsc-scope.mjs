#!/usr/bin/env node
// Type-checks the project and fails only if tsc reports errors in the named files (substring match).
// Lets a task be verified on its own while other tasks' specs still reference modules that do not exist yet.
import { spawnSync } from "node:child_process";
const files = process.argv.slice(2);
if (files.length === 0) { console.error("usage: tsc-scope.mjs <path-substring>..."); process.exit(2); }
const r = spawnSync("npx", ["tsc", "-p", "tsconfig.json", "--noEmit"], { encoding: "utf8" });
const out = `${r.stdout}${r.stderr}`;
const mine = out.split("\n").filter((l) => files.some((f) => l.includes(f)));
if (mine.length) { console.log(mine.join("\n")); process.exit(1); }
console.log(`no type errors in: ${files.join(", ")}`);
