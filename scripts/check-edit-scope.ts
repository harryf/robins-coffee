#!/usr/bin/env bun
// CI guard for pull requests from ROBIN's Studio (branches named edit/...): they may change
// content, moments, events and data, and nothing else. No template, no code, no
// workflow, no design token. The rule itself is `inEditScope` in src/scope.ts.
//   git diff --name-only --no-renames origin/main...HEAD | bun scripts/check-edit-scope.ts
// It catches a Studio that went wrong, not a person who means harm: a person can name
// their branch something else. The approval the main branch asks for covers that.
import { inEditScope } from "../src/scope";

export const outOfScope = (paths: string[]) => paths.map((p) => p.trim()).filter((p) => p && !inEditScope(p));

if (import.meta.main) {
  const bad = outOfScope((await Bun.stdin.text()).split("\n"));
  for (const p of bad) console.error(process.env.GITHUB_ACTIONS ? `::error title=Outside the Studio's reach::${p}` : `OUT OF SCOPE: ${p}`);
  console.log(bad.length ? `${bad.length} file(s) a Studio change may not touch` : "Studio change: every file is inside content, moments, events or data");
  if (bad.length) process.exit(1);
}
