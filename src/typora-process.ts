import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TyporaProcess {
  pid: number;
  command: string;
}

export interface CandidateOptions {
  platform?: NodeJS.Platform;
  explicitPath?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LaunchOptions extends CandidateOptions {
  filePath?: string;
  debugPort?: number;
  debugging?: boolean;
  userDataDir?: string;
  extraArgs?: string[];
}

export function typoraExecutableCandidates(options: CandidateOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const paths = platform === "win32" ? path.win32 : path.posix;
  const candidates = [options.explicitPath, env.TYPORA_PATH];

  if (platform === "win32") {
    if (env.LOCALAPPDATA) candidates.push(paths.join(env.LOCALAPPDATA, "Programs", "Typora", "Typora.exe"));
    if (env.ProgramFiles) candidates.push(paths.join(env.ProgramFiles, "Typora", "Typora.exe"));
    if (env["ProgramFiles(x86)"]) {
      candidates.push(paths.join(env["ProgramFiles(x86)"]!, "Typora", "Typora.exe"));
    }
  } else if (platform === "darwin") {
    candidates.push("/Applications/Typora.app/Contents/MacOS/Typora");
    if (env.HOME) candidates.push(paths.join(env.HOME, "Applications", "Typora.app", "Contents", "MacOS", "Typora"));
  } else {
    candidates.push("/usr/bin/typora", "/usr/local/bin/typora", "/snap/bin/typora", "/opt/Typora/typora");
  }

  const executable = platform === "win32" ? "Typora.exe" : "typora";
  const delimiter = platform === "win32" ? ";" : ":";
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    candidates.push(paths.join(directory, executable));
  }

  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

export async function findTyporaExecutable(options: CandidateOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const candidates = typoraExecutableCandidates(options);
  if (platform === "win32") candidates.push(...(await windowsRegistryCandidates()));
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }
  return null;
}

export function parseWindowsRegistryPaths(output: string): string[] {
  return [...new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const quoted = line.match(/^"([^"]+)"/);
        const value = (quoted?.[1] ?? line).replace(/,\d+$/, "").trim();
        return /\.exe$/i.test(value) ? value : path.win32.join(value, "Typora.exe");
      }),
  )];
}

async function windowsRegistryCandidates(): Promise<string[]> {
  const registryScript =
    "$keys = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'; " +
    "Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*Typora*' } | ForEach-Object { $_.InstallLocation; $_.DisplayIcon }";
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", registryScript], {
      windowsHide: true,
    });
    return parseWindowsRegistryPaths(stdout);
  } catch {
    return [];
  }
}

export function buildLaunchArgs(options: Pick<LaunchOptions, "debugPort" | "debugging" | "filePath" | "userDataDir" | "extraArgs">): string[] {
  if (options.debugging !== false && !options.debugPort) throw new RangeError("debugPort is required");
  return [
    ...(options.debugging === false ? [] : [`--remote-debugging-port=${options.debugPort}`]),
    ...(options.userDataDir ? [`--user-data-dir=${options.userDataDir}`] : []),
    ...(options.extraArgs ?? []),
    ...(options.filePath ? [options.filePath] : []),
  ];
}

export function parseTasklistOutput(output: string): TyporaProcess[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^"([^"]+)","(\d+)"/))
    .filter((match): match is RegExpMatchArray => Boolean(match && /^typora\.exe$/i.test(match[1]!)))
    .map((match) => ({ pid: Number(match[2]), command: match[1]! }));
}

export function parsePsOutput(output: string): TyporaProcess[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) return [];
    const [, rawPid, name, command] = match;
    if (!/^typora$/i.test(name!) && !/(^|[\\/\s])typora(?:\.app)?([\\/\s]|$)/i.test(command!)) return [];
    return [{ pid: Number(rawPid), command: command! }];
  });
}

export async function listTyporaProcesses(platform: NodeJS.Platform = process.platform): Promise<TyporaProcess[]> {
  if (platform === "win32") {
    const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq Typora.exe", "/FO", "CSV", "/NH"]);
    return parseTasklistOutput(stdout);
  }
  const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,comm=,args="]);
  return parsePsOutput(stdout).filter((item) => item.pid !== process.pid);
}

export function buildWindowsCloseCommand(pid: number, force: boolean): string[] {
  return ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
}

export async function closeTyporaProcess(
  pid: number,
  force = false,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (!Number.isInteger(pid) || pid < 1) throw new RangeError("pid must be positive");
  if (platform === "win32") {
    await execFileAsync("taskkill", buildWindowsCloseCommand(pid, force));
    return;
  }
  process.kill(pid, force ? "SIGKILL" : "SIGTERM");
}

export async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a TCP port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export class TyporaProcessManager {
  #child: ChildProcess | null = null;
  #debugPort: number | null = null;
  #executablePath: string | null = null;
  #filePath: string | null = null;

  status() {
    const running = Boolean(this.#child && this.#child.exitCode === null && !this.#child.killed);
    return {
      running,
      owned: running,
      pid: this.#child?.pid ?? null,
      debugPort: this.#debugPort,
      executablePath: this.#executablePath,
      filePath: this.#filePath,
      endpoint: this.#debugPort ? `http://127.0.0.1:${this.#debugPort}` : null,
    };
  }

  async launch(options: LaunchOptions = {}) {
    if (this.status().running) return this.status();
    const executablePath = await findTyporaExecutable(options);
    if (!executablePath) {
      const error = new Error("Typora executable was not found");
      error.name = "TYPORA_NOT_FOUND";
      throw error;
    }
    const debugPort = options.debugPort ?? (await findFreePort());
    const child = spawn(executablePath, buildLaunchArgs({ ...options, debugPort }), {
      stdio: "ignore",
      windowsHide: false,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    this.#child = child;
    this.#debugPort = debugPort;
    this.#executablePath = executablePath;
    this.#filePath = options.filePath ?? null;
    return this.status();
  }

  async close(force = false): Promise<boolean> {
    if (!this.#child || this.#child.exitCode !== null) return false;
    const pid = this.#child.pid;
    if (!pid) return false;
    try {
      if (process.platform === "win32") await closeTyporaProcess(pid, force);
      else if (!this.#child.kill(force ? "SIGKILL" : "SIGTERM")) return false;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    return true;
  }
}
