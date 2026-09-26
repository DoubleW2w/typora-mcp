import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLaunchArgs,
  parsePsOutput,
  parseTasklistOutput,
  typoraExecutableCandidates,
} from "../src/typora-process.js";

test("Typora executable candidates prefer explicit and environment paths", () => {
  const candidates = typoraExecutableCandidates({
    platform: "win32",
    explicitPath: "D:\\Apps\\Typora.exe",
    env: {
      TYPORA_PATH: "E:\\Portable\\Typora.exe",
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      PATH: "C:\\Tools",
    },
  });

  assert.deepEqual(candidates.slice(0, 5), [
    "D:\\Apps\\Typora.exe",
    "E:\\Portable\\Typora.exe",
    "C:\\Users\\me\\AppData\\Local\\Programs\\Typora\\Typora.exe",
    "C:\\Program Files\\Typora\\Typora.exe",
    "C:\\Program Files (x86)\\Typora\\Typora.exe",
  ]);
});

test("macOS and Linux candidates include their native application locations", () => {
  assert.ok(
    typoraExecutableCandidates({ platform: "darwin", env: { HOME: "/Users/me" } }).includes(
      "/Applications/Typora.app/Contents/MacOS/Typora",
    ),
  );
  assert.ok(
    typoraExecutableCandidates({ platform: "linux", env: { HOME: "/home/me" } }).includes(
      "/usr/bin/typora",
    ),
  );
});

test("launch arguments enable CDP without shell interpolation", () => {
  assert.deepEqual(
    buildLaunchArgs({
      debugPort: 9333,
      filePath: "D:\\notes\\a file.md",
      extraArgs: ["--theme", "night"],
    }),
    ["--remote-debugging-port=9333", "--theme", "night", "D:\\notes\\a file.md"],
  );
});

test("process listings keep only Typora processes", () => {
  assert.deepEqual(
    parseTasklistOutput(
      '"Typora.exe","1234","Console","1","120,000 K"\n"Other.exe","9","Console","1","1 K"',
    ),
    [{ pid: 1234, command: "Typora.exe" }],
  );
  assert.deepEqual(
    parsePsOutput("  42 Typora /Applications/Typora.app/Contents/MacOS/Typora\n  99 bash bash"),
    [{ pid: 42, command: "/Applications/Typora.app/Contents/MacOS/Typora" }],
  );
});
