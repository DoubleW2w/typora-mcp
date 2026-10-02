import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  bridgeBlock,
  bridgeStatus,
  injectBridge,
  installBridge,
  removeBridge,
  typoraWindowHtmlPath,
  uninstallBridge,
} from "../src/bridge-installer.js";
import { standaloneBridgeSource } from "../src/standalone-bridge.js";

const config = {
  registryDir: "C:\\Temp\\typora-mcp\\targets",
  token: "token",
};

test("bridge injection is idempotent and preserves the host document", () => {
  const source = "<html><body><main>Typora</main></body></html>";
  const injected = injectBridge(source, config);

  assert.match(injected, /typora-mcp-bridge:start/);
  assert.match(injected, /typora-mcp-bridge\.js/);
  assert.equal(injectBridge(injected, config), injected);
  assert.equal(removeBridge(injected), source);
});

test("bridge block includes only local registry and token configuration", () => {
  const block = bridgeBlock(config);
  assert.match(block, /C:\\\\Temp\\\\typora-mcp\\\\targets/);
  assert.match(block, /"token"/);
  assert.doesNotMatch(block, /remote_control/);
});

test("Typora window.html resolves beside the executable resources directory", () => {
  assert.equal(
    typoraWindowHtmlPath("D:\\Typora\\Typora.exe", "win32"),
    "D:\\Typora\\resources\\window.html",
  );
  assert.equal(
    typoraWindowHtmlPath("/Applications/Typora.app/Contents/MacOS/Typora", "darwin"),
    "/Applications/Typora.app/Contents/Resources/TypeMark/index.html",
  );
});

test("installation keeps the first host backup and uninstall removes only the bridge", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "typora-mcp-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const windowHtmlPath = join(directory, "window.html");
  const source = "<html><body><main>Typora</main></body></html>";
  await writeFile(windowHtmlPath, source);

  await installBridge(windowHtmlPath, config, "// first bridge");
  await installBridge(windowHtmlPath, config, "// updated bridge");
  assert.equal(await readFile(windowHtmlPath + ".typora-mcp-backup", "utf8"), source);
  assert.equal(await readFile(join(directory, "typora-mcp-bridge.js"), "utf8"), "// updated bridge");
  assert.equal((await bridgeStatus(windowHtmlPath)).installed, true);

  await uninstallBridge(windowHtmlPath);
  assert.equal(await readFile(windowHtmlPath, "utf8"), source);
  assert.equal((await bridgeStatus(windowHtmlPath)).backupExists, true);
});

test("standalone bridge uses authenticated loopback RPC rather than a plugin adapter", () => {
  assert.match(standaloneBridgeSource, /http\.createServer/);
  assert.match(standaloneBridgeSource, /127\.0\.0\.1/);
  assert.match(standaloneBridgeSource, /Bearer/);
  assert.doesNotMatch(standaloneBridgeSource, /remote_control/);
});
