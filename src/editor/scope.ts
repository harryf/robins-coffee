// The files an editor pull request may touch, by repository path: content, moments,
// events, section photos and data, never the design tokens, templates, code or workflows.
// This file imports nothing on purpose: CI runs the copy from the base branch, before
// anything is installed, so a change cannot loosen its own guard (scripts/check-edit-scope.ts).
export const inEditScope = (repoPath: string) =>
  /^site\/(content|moments|events)\/[^/].*/.test(repoPath) || /^site\/photos\/[a-z0-9-]+\.jpg$/.test(repoPath) || (/^site\/data\/[^/]+$/.test(repoPath) && repoPath !== "site/data/tokens.json");
