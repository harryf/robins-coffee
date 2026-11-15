#!/usr/bin/env bun
// CI guard for pull requests from the editor (branches named edit/...): they may change
// content, moments, events and data, and nothing else. No template, no code, no
// workflow, no design token. The rule itself is `inEditScope` in src/editor/changes.ts.
//   git diff --name-only origin/main...HEAD | bun scripts/check-edit-scope.ts
import { inEditScope } from "../src/editor/changes";

export const outOfScope = (paths: string[]) => paths.map((p) => p.trim()).filter((p) => p && !inEditScope(p));

if (import.meta.main) {
  const bad = outOfScope((await Bun.stdin.text()).split("\n"));
  for (const p of bad) console.error(process.env.GITHUB_ACTIONS ? `::error title=Outside the editor's reach::${p}` : `OUT OF SCOPE: ${p}`);
  console.log(bad.length ? `${bad.length} file(s) an editor change may not touch` : "editor change: every file is inside content, moments, events or data");
  if (bad.length) process.exit(1);
}
