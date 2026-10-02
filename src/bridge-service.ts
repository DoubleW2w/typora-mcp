import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  bridgeStatus,
  installBridge,
  typoraWindowHtmlPath,
  uninstallBridge,
  type BridgeConfig,
} from "./bridge-installer.js";
import { standaloneBridgeSource, standaloneBridgeVersion } from "./standalone-bridge.js";
import { findTyporaExecutable } from "./typora-process.js";

export function defaultRegistryDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "typora-mcp", "targets");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "typora-mcp", "targets");
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "typora-mcp", "targets");
}

export class StandaloneBridgeInstaller {
  async #windowHtmlPath(executablePath?: string): Promise<string> {
    const executable = await findTyporaExecutable({ explicitPath: executablePath });
    if (!executable) {
      const error = new Error("Typora executable was not found");
      error.name = "TYPORA_NOT_FOUND";
      throw error;
    }
    return typoraWindowHtmlPath(executable);
  }

  async status(executablePath?: string) {
    const windowHtmlPath = await this.#windowHtmlPath(executablePath);
    const status = await bridgeStatus(windowHtmlPath);
    const expectedBridgeHash = createHash("sha256").update(standaloneBridgeSource).digest("hex");
    return {
      ...status,
      bridgeVersion: standaloneBridgeVersion,
      expectedBridgeHash,
      bridgeMismatch: status.bridgeHash !== null && status.bridgeHash !== expectedBridgeHash,
      restartRequired: false,
    };
  }

  async install(options: { executablePath?: string; registryDir?: string; token?: string } = {}) {
    const windowHtmlPath = await this.#windowHtmlPath(options.executablePath);
    const config: BridgeConfig = {
      registryDir: options.registryDir ?? defaultRegistryDir(),
      token: options.token ?? randomBytes(32).toString("base64url"),
    };
    return {
      ...(await installBridge(windowHtmlPath, config, standaloneBridgeSource)),
      bridgeVersion: standaloneBridgeVersion,
      expectedBridgeHash: createHash("sha256").update(standaloneBridgeSource).digest("hex"),
      registryDir: config.registryDir,
      restartRequired: true,
    };
  }

  async uninstall(executablePath?: string) {
    const windowHtmlPath = await this.#windowHtmlPath(executablePath);
    return { ...(await uninstallBridge(windowHtmlPath)), restartRequired: true };
  }
}
