import { posix, win32 } from "node:path";
import { createHash } from "node:crypto";
import { access, copyFile, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface BridgeConfig {
  registryDir: string;
  token: string;
}

const START = "<!-- typora-mcp-bridge:start -->";
const END = "<!-- typora-mcp-bridge:end -->";
const BLOCK = new RegExp(`${START}[\\s\\S]*?${END}\\r?\\n?`, "g");
const BACKUP_SUFFIX = ".typora-mcp-backup";
const BRIDGE_FILE = "typora-mcp-bridge.js";

function serializedConfig(config: BridgeConfig): string {
  return JSON.stringify(config).replace(/</g, "\\\\u003c");
}

export function bridgeBlock(config: BridgeConfig): string {
  return `${START}
<script>
window.__TYPORA_MCP_BRIDGE_CONFIG__ = ${serializedConfig(config)};
</script>
<script src="./typora-mcp-bridge.js" defer="defer"></script>
${END}
`;
}

export function removeBridge(windowHtml: string): string {
  return windowHtml.replace(BLOCK, "");
}

export function injectBridge(windowHtml: string, config: BridgeConfig): string {
  const clean = removeBridge(windowHtml);
  const closingBody = clean.match(/<\/body\s*>/i);
  if (!closingBody || closingBody.index === undefined) {
    throw new Error("Typora window.html does not contain a closing body tag");
  }

  return `${clean.slice(0, closingBody.index)}${bridgeBlock(config)}${clean.slice(closingBody.index)}`;
}

export function typoraWindowHtmlPath(
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return win32.join(win32.dirname(executablePath), "resources", "window.html");
  }
  if (platform === "darwin") {
    return posix.join(posix.dirname(executablePath), "..", "Resources", "TypeMark", "index.html");
  }
  return posix.join(posix.dirname(executablePath), "..", "resources", "window.html");
}

export interface BridgeInstallPaths {
  windowHtmlPath: string;
  bridgeScriptPath: string;
  backupPath: string;
}

export interface BridgeStatus extends BridgeInstallPaths {
  installed: boolean;
  backupExists: boolean;
  bridgeHash: string | null;
}

export function bridgeInstallPaths(windowHtmlPath: string): BridgeInstallPaths {
  return {
    windowHtmlPath,
    bridgeScriptPath: join(dirname(windowHtmlPath), BRIDGE_FILE),
    backupPath: windowHtmlPath + BACKUP_SUFFIX,
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function bridgeStatus(windowHtmlPath: string): Promise<BridgeStatus> {
  const paths = bridgeInstallPaths(windowHtmlPath);
  const windowHtml = (await exists(paths.windowHtmlPath)) ? await readFile(paths.windowHtmlPath, "utf8") : "";
  const bridgeScript = (await exists(paths.bridgeScriptPath)) ? await readFile(paths.bridgeScriptPath, "utf8") : null;
  return {
    ...paths,
    installed: windowHtml.includes(START) && windowHtml.includes(END) && bridgeScript !== null,
    backupExists: await exists(paths.backupPath),
    bridgeHash: bridgeScript ? createHash("sha256").update(bridgeScript).digest("hex") : null,
  };
}

export async function installBridge(
  windowHtmlPath: string,
  config: BridgeConfig,
  bridgeScript: string,
): Promise<BridgeStatus> {
  const paths = bridgeInstallPaths(windowHtmlPath);
  const source = await readFile(paths.windowHtmlPath, "utf8");
  if (!(await exists(paths.backupPath))) await copyFile(paths.windowHtmlPath, paths.backupPath);
  await writeFile(paths.bridgeScriptPath, bridgeScript, "utf8");
  await writeFile(paths.windowHtmlPath, injectBridge(source, config), "utf8");
  return bridgeStatus(paths.windowHtmlPath);
}

export async function uninstallBridge(windowHtmlPath: string): Promise<BridgeStatus> {
  const paths = bridgeInstallPaths(windowHtmlPath);
  const source = await readFile(paths.windowHtmlPath, "utf8");
  await writeFile(paths.windowHtmlPath, removeBridge(source), "utf8");
  if (await exists(paths.bridgeScriptPath)) await unlink(paths.bridgeScriptPath);
  return bridgeStatus(paths.windowHtmlPath);
}
