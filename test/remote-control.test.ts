import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { RemoteControlClient } from "../src/remote-control.js";

test("remote control client authenticates JSON-RPC requests and returns results", async () => {
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer token");
    let body = "";
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true, method: message.method } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const client = new RemoteControlClient({ endpoint: `http://127.0.0.1:${address.port}/`, token: "token" });
    assert.deepEqual(await client.request("system.ping"), { ok: true, method: "system.ping" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("remote control client exposes remote JSON-RPC errors", async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "EVAL_DISABLED", data: { typoraCode: "EVAL_DISABLED" } } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const client = new RemoteControlClient({ endpoint: `http://127.0.0.1:${address.port}/`, token: "token" });
    await assert.rejects(() => client.request("system.eval"), /EVAL_DISABLED/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
