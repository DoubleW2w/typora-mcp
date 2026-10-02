import assert from "node:assert/strict";
import http from "node:http";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StandaloneBridgeClient } from "../src/standalone-client.js";

test("standalone client ignores stale registry entries before selecting a target", async (t) => {
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer live-token");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "test", result: { targetId: "live" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const registryDir = await mkdtemp(join(tmpdir(), "typora-mcp-registry-"));
  t.after(() => rm(registryDir, { recursive: true, force: true }));

  await writeFile(join(registryDir, "stale.json"), JSON.stringify({
    version: 1, targetId: "stale", host: "127.0.0.1", port: 1, token: "stale-token", pid: 99999999, createdAt: "",
  }));
  await writeFile(join(registryDir, "live.json"), JSON.stringify({
    version: 1, targetId: "live", host: "127.0.0.1", port: address.port, token: "live-token", pid: 2, createdAt: "",
  }));

  const client = new StandaloneBridgeClient(registryDir, async () => []);
  assert.deepEqual((await client.targets()).map((target) => target.targetId), ["live"]);
  await assert.rejects(access(join(registryDir, "stale.json")));
  assert.deepEqual(await client.call("status"), { targetId: "live" });
});

test("standalone client retains an unreachable entry while its PID belongs to Typora", async (t) => {
  const registryDir = await mkdtemp(join(tmpdir(), "typora-mcp-registry-"));
  t.after(() => rm(registryDir, { recursive: true, force: true }));
  const stalePath = join(registryDir, "still-owned.json");
  await writeFile(stalePath, JSON.stringify({
    version: 1, targetId: "still-owned", host: "127.0.0.1", port: 1, token: "token", pid: process.pid, createdAt: "",
  }));

  assert.deepEqual(await new StandaloneBridgeClient(registryDir, async () => [{ pid: process.pid, command: "Typora.exe" }]).targets(), []);
  await access(stalePath);
});
