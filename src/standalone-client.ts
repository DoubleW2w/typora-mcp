import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultRegistryDir } from "./bridge-service.js";

export interface StandaloneTarget {
  version: number;
  bridgeVersion?: number;
  targetId: string;
  host: "127.0.0.1";
  port: number;
  token: string;
  pid: number;
  createdAt: string;
}

export class StandaloneBridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = code;
  }
}

export class StandaloneBridgeClient {
  constructor(readonly registryDir = process.env.TYPORA_MCP_REGISTRY_DIR ?? defaultRegistryDir()) {}

  async targets(): Promise<StandaloneTarget[]> {
    let files: string[];
    try {
      files = await readdir(this.registryDir);
    } catch {
      return [];
    }
    const targets = await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
      try {
        const entry = JSON.parse(await readFile(join(this.registryDir, file), "utf8")) as StandaloneTarget;
        return entry.version === 1 && entry.host === "127.0.0.1" && typeof entry.targetId === "string" &&
          Number.isInteger(entry.port) && typeof entry.token === "string"
          ? entry
          : null;
      } catch {
        return null;
      }
    }));
    const registryTargets = targets.filter((entry): entry is StandaloneTarget => entry !== null);
    const online = await Promise.all(registryTargets.map(async (entry) => {
      try {
        await this.#request(entry, "status", {});
        return entry;
      } catch {
        return null;
      }
    }));
    return online.filter((entry): entry is StandaloneTarget => entry !== null);
  }

  async available(): Promise<boolean> {
    return (await this.targets()).length > 0;
  }

  async call(method: string, params: Record<string, unknown> = {}, targetId?: string): Promise<any> {
    const targets = await this.targets();
    let target = targetId ? targets.find((entry) => entry.targetId === targetId) : undefined;
    if (!target && !targetId && targets.length > 1) {
      const focused = (await Promise.all(targets.map(async (entry) => ({
        entry,
        status: await this.#request(entry, "status", {}),
      })))).filter((item) => item.status?.focused);
      if (focused.length === 1) target = focused[0]!.entry;
    }
    if (!target && !targetId && targets.length === 1) target = targets[0];
    if (!target) {
      throw new StandaloneBridgeError(
        targetId ? "TYPORA_BRIDGE_TARGET_NOT_FOUND" : "TYPORA_BRIDGE_TARGET_AMBIGUOUS",
        targetId ? "No standalone bridge target exists for " + targetId : "A targetId is required unless exactly one standalone bridge is connected",
      );
    }
    return await this.#request(target, method, params);
  }

  async #request(target: StandaloneTarget, method: string, params: Record<string, unknown>): Promise<any> {
    const signal = AbortSignal.timeout(5_000);
    let response: Response;
    try {
      response = await fetch("http://" + target.host + ":" + target.port + "/", {
        method: "POST",
        headers: { authorization: "Bearer " + target.token, "content-type": "application/json" },
        body: JSON.stringify({ id: randomUUID(), method, params }),
        signal,
      });
    } catch (error) {
      throw new StandaloneBridgeError("TYPORA_BRIDGE_UNAVAILABLE", error instanceof Error ? error.message : String(error));
    }
    const payload = await response.json() as { result?: unknown; error?: { code?: string; message?: string } };
    if (!response.ok || payload.error) {
      throw new StandaloneBridgeError(payload.error?.code ?? "TYPORA_BRIDGE_ERROR", payload.error?.message ?? response.statusText);
    }
    return payload.result;
  }
}
