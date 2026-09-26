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
  for (const candidate of typoraExecutableCandidates(options)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }
  return null;
}

export function buildLaunchArgs(options: Pick<LaunchOptions, "debugPort" | "filePath" | "extraArgs">): string[] {
  if (!options.debugPort) throw new RangeError("debugPort is required");
  return [
    `--remote-debugging-port=${options.debugPort}`,
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

  status() {
    return {
      running: Boolean(this.#child && this.#child.exitCode === null && !this.#child.killed),
      owned: Boolean(this.#child),
      pid: this.#child?.pid ?? null,
      debugPort: this.#debugPort,
      executablePath: this.#executablePath,
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
    return this.status();
  }

  async close(force = false): Promise<boolean> {
    if (!this.#child || this.#child.exitCode !== null) return false;
    const closed = this.#child.kill(force ? "SIGKILL" : "SIGTERM");
    if (closed) await new Promise((resolve) => setTimeout(resolve, 100));
    return closed;
  }
}
