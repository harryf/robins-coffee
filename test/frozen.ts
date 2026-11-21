// The tests of the code run on a frozen copy of the content (test/fixture/site), not on
// the live folder. The bar changes hours, photos, albums and events every week through
// the Studio; a test that counted today's albums failed the build of such a change and
// kept it from going live (21 Nov 2026). What must hold for whatever the bar writes is
// in test/live-content.test.ts, which reads the live folder.
//
// Templates, assets and design tokens stay live: they are code. So a new label or page
// field that a template needs goes into site/ and into test/fixture/site/ together.
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const LIVE_SITE = join(ROOT, "site");
const FIXTURE = join(import.meta.dir, "fixture", "site");
/** What the bar edits. Everything else under site/ is code and is taken as it is now. */
const CONTENT = ["content", "events", "moments", "photos"];
const isData = (name: string) => name.endsWith(".yml");

/** Swap the content of a site folder for the frozen copy; templates, assets and tokens stay. */
export function freezeSite(site: string): void {
  for (const dir of CONTENT) {
    rmSync(join(site, dir), { recursive: true, force: true });
    cpSync(join(FIXTURE, dir), join(site, dir), { recursive: true });
  }
  for (const name of readdirSync(join(site, "data")).filter(isData)) rmSync(join(site, "data", name));
  for (const name of readdirSync(join(FIXTURE, "data")).filter(isData)) cpSync(join(FIXTURE, "data", name), join(site, "data", name));
}

/** A site folder with live code and frozen content, made once per test run. */
export const FROZEN_SITE = (() => {
  const site = join(mkdtempSync(join(tmpdir(), "robins-frozen-")), "site");
  cpSync(LIVE_SITE, site, { recursive: true });
  freezeSite(site);
  return site;
})();
