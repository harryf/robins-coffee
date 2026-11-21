import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STEPS, STEP_PREFIX, changelogAnchor, changelogUrl, nextInstallRecord, parseStepLine, stepLine, updateNotice, versionOf } from "../src/studio/startup";
import { startPage, startWords } from "../src/studio/start-page";
import { installedDay } from "../src/studio/ui/system";
import { STRINGS } from "../src/studio/strings";
import { tokensCss } from "../src/tokens";

const ROOT = join(import.meta.dir, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("studio start: the launcher's step lines", () => {
  test("a step line is the prefix and a known name; nothing else is a step", () => {
    for (const step of STEPS) expect(parseStepLine(stepLine(step))).toBe(step);
    expect(parseStepLine("studio-step: starting\r")).toBe("starting");
    expect(parseStepLine("studio-step: <b>hi</b>")).toBeNull();
    expect(parseStepLine("studio-step: unknown")).toBeNull();
    expect(parseStepLine("Updated the Studio (0.10.1 to 0.11.0).")).toBeNull();
    expect(parseStepLine("  studio-step: starting")).toBeNull();
    expect(parseStepLine("")).toBeNull();
  });
  test("the app knows the same prefix, takes only a to z names, and calls the page with nothing else", () => {
    const swift = read("app", "Studio.swift");
    expect(swift).toContain(`let stepPrefix = ${JSON.stringify(STEP_PREFIX)}`);
    expect(swift).toContain(`("a"..."z").contains($0)`);
    // The only script the app runs in the page is the step call with that checked name.
    expect([...swift.matchAll(/evaluateJavaScript\(([^,]+),/g)].map((m) => m[1])).toEqual([`"window.studioStep && window.studioStep(\\"\\(step)\\")"`]);
    for (const step of STEPS) expect(step).toMatch(/^[a-z]+$/);
  });
  test("the launcher says checking before the update and starting before the server", () => {
    const launch = read("src", "studio", "launch.ts");
    expect(launch.indexOf('say("checking")')).toBeGreaterThan(0);
    expect(launch.indexOf('say("checking")')).toBeLessThan(launch.indexOf("selfUpdate({"));
    expect(launch.indexOf('say("starting")')).toBeGreaterThan(launch.indexOf("selfUpdate({"));
    expect(launch.indexOf('say("starting")')).toBeLessThan(launch.indexOf('join("src", "studio", "server.ts")'));
  });
});

describe("studio start: the start screen", () => {
  const tokens = JSON.parse(read("site", "data", "tokens.json"));
  const page = startPage(tokens, STRINGS);
  test("logo, name and the first status, with words for every step from strings.ts", () => {
    expect(page).toContain('src="logo.png"');
    expect(page).toContain(`<h1 class="start__name">${STRINGS.app_name}</h1>`);
    expect(page).toContain(`id="step" role="status" aria-live="polite">${STRINGS.start_checking}</p>`);
    const words = startWords(STRINGS);
    for (const step of STEPS) {
      expect(words[step]).toBeTruthy();
      expect(page).toContain(JSON.stringify(words[step]));
    }
  });
  test("night colours and type from the tokens; its own CSS types no colour and no font size", () => {
    expect(page).toContain(`--c-bg: ${tokens.color.night.bg};`);
    const own = page.replace(tokensCss(tokens), "");
    expect(own.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi)).toBe(null);
    expect([...own.matchAll(/font-size:\s*([^;]+)/g)].map((m) => m[1]!).filter((v) => !/^var\(--size-[a-z]+\)$/.test(v))).toEqual([]);
    expect(own).not.toMatch(/font-family:\s*['"A-Z]/);
  });
  test("ANTI: the page sets text only, never HTML, and asks for nothing from the network", () => {
    expect(page).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(page).toContain("line.textContent = WORDS[name]");
    expect(page).toContain("Content-Security-Policy");
    expect(page).not.toMatch(/https?:\/\//);
  });
});

describe("studio: version numbers, the install day and the changelog", () => {
  test("a version.json text gives its number, anything else gives none", () => {
    expect(versionOf('{ "version": "0.11.0" }')).toBe("0.11.0");
    expect(versionOf('{ "version": "<b>" }')).toBeNull();
    expect(versionOf("nope")).toBeNull();
    expect(versionOf(null)).toBeNull();
  });
  test("the install record keeps a known version's first day, and dates a new one by its update or by now", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const updated = { result: "updated", at: "2026-11-21T08:00:00.000Z" };
    expect(nextInstallRecord(null, { number: "0.11.0", commit: "c" }, updated, now)).toEqual({ version: "0.11.0", commit: "c", at: updated.at });
    expect(nextInstallRecord(null, { number: "0.11.0", commit: "c" }, { result: "current", at: "x" }, now)).toEqual({ version: "0.11.0", commit: "c", at: now.toISOString() });
    expect(nextInstallRecord(null, { number: "0.11.0", commit: "c" }, null, now).at).toBe(now.toISOString());
    const known = { version: "0.11.0", commit: "c", at: "2026-11-01T00:00:00.000Z" };
    expect(nextInstallRecord(known, { number: "0.11.0", commit: "d" }, updated, now)).toBe(known);
    expect(nextInstallRecord(known, { number: "0.12.0", commit: "d" }, updated, now)).toEqual({ version: "0.12.0", commit: "d", at: updated.at });
  });
  test("the changelog link: the repository, the full commit, the heading's anchor", () => {
    const commit = "a".repeat(40);
    expect(changelogAnchor("0.11.0")).toBe("0110");
    expect(changelogUrl("harryf/robins-coffee", commit, "0.11.0")).toBe(`https://github.com/harryf/robins-coffee/blob/${commit}/src/studio/CHANGELOG.md#0110`);
    expect(changelogUrl("harryf/robins-coffee", commit, "?")).toBe(`https://github.com/harryf/robins-coffee/blob/${commit}/src/studio/CHANGELOG.md`);
    expect(changelogUrl("harryf/robins-coffee", "abc1234", "0.11.0")).toBeNull();
    expect(changelogUrl("evil.example/x/y", commit, "0.11.0")).toBeNull();
    expect(changelogUrl("", commit, "0.11.0")).toBeNull();
  });
  test("the update note: for an update this start made, until its note is closed", () => {
    const update = { result: "updated", to: "b".repeat(40), fromVersion: "0.10.1", toVersion: "0.11.0" };
    expect(updateNotice(update, null)).toEqual({ to: update.to, fromVersion: "0.10.1", toVersion: "0.11.0", appRebuilt: undefined });
    expect(updateNotice({ ...update, appRebuilt: true }, "c".repeat(40))!.appRebuilt).toBe(true);
    expect(updateNotice(update, update.to)).toBeNull();
    expect(updateNotice({ ...update, result: "current" }, null)).toBeNull();
    expect(updateNotice({ result: "failed", reason: "install", to: "x" } as any, null)).toBeNull();
    expect(updateNotice(null, null)).toBeNull();
    expect(STRINGS.notice_updated("0.11.0", "0.10.1")).toBe("ROBIN's Studio was updated to 0.11.0 (from 0.10.1).");
    expect(STRINGS.notice_updated("0.11.0", undefined)).toBe("ROBIN's Studio was updated to 0.11.0.");
    expect(STRINGS.notice_updated(undefined, undefined)).toBe("ROBIN's Studio was updated.");
  });
  test("the install day in words, without Intl", () => {
    expect(installedDay(STRINGS, "2026-11-21T12:00:00.000Z")).toBe("21 November 2026");
    expect(installedDay(STRINGS, null)).toBeNull();
    expect(installedDay(STRINGS, "not a date")).toBeNull();
  });
  test("the changelog has a heading for the version in version.json, newest first, plain text", () => {
    const version = JSON.parse(read("src", "studio", "version.json")).version as string;
    const log = read("src", "studio", "CHANGELOG.md");
    const headings = [...log.matchAll(/^## (\d+\.\d+\.\d+)\s*$/gm)].map((m) => m[1]!);
    expect(headings).toContain(version);
    expect(headings[0]).toBe(version);
    const key = (v: string) => v.split(".").map(Number).reduce((a, n) => a * 1000 + n, 0);
    expect(headings).toEqual([...headings].sort((a, b) => key(b) - key(a)));
    expect(new Set(headings.map(changelogAnchor)).size).toBe(headings.length);
    expect(log).not.toContain(String.fromCharCode(0x2014));
  });
});
