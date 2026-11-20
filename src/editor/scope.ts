// The files an editor pull request may touch, by repository path: page texts, moments,
// events, section photos and data, never the design tokens, templates, code or workflows.
// Each folder takes only its own kind of file, in lower case: a photo is a .jpg that went
// through the cleaning step, never an original dropped in by hand (a .HEIC, a .png), and
// a name in capitals cannot stand in for a protected file on a disk that ignores case.
// This file imports nothing on purpose: CI runs the copy from the base branch, before
// anything is installed, so a change cannot loosen its own guard (scripts/check-edit-scope.ts).
export const inEditScope = (repoPath: string) =>
  /^site\/content\/[a-z]{2}\/[a-z0-9-]+\.md$/.test(repoPath) ||
  /^site\/moments\/[a-z0-9-]+\.(jpg|md)$/.test(repoPath) ||
  /^site\/events\/([a-z0-9-]+|README)\.md$/.test(repoPath) ||
  /^site\/photos\/[a-z0-9-]+\.jpg$/.test(repoPath) ||
  /^site\/data\/[a-z0-9-]+\.yml$/.test(repoPath);
