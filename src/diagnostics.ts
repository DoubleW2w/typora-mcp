import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ARCHIVE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const SAFE_FIELDS = new Set([
  "targetId", "selector", "snapshotId", "ref", "key", "path", "fixturePath",
  "allowSharedTarget", "force", "maxNodes", "afterSeq", "limit", "sourceHash",
  "rendererHash", "runId", "backend", "bridge", "status", "code",
  "evidenceDirectory", "filePath", "snapshotId", "latestDebugSeq", "passed",
  "assertions", "running", "rendererConnected", "activeTargetId", "reloaded",
  "clicked", "typed", "pressed", "scrolled", "characters",
]);
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DiagnosticRun {
  runId: string;
  name: string;
  startedAt: string;
  directory: string;
}

export interface DiagnosticEntry {
  at: string;
  tool: string;
  args: unknown;
  outcome: "ok" | "error";
  durationMs?: number;
  result?: unknown;
  error?: { code: string; message: string };
}

interface DiagnosticSummary extends DiagnosticRun {
  endedAt?: string;
  entryCount: number;
}

interface Options {
  now?: () => number;
  archiveLimitBytes?: number;
}

function defaultRoot(): string {
  return process.env.TYPORA_MCP_DIAGNOSTICS_DIR
    ?? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "typora-mcp", "diagnostics");
}

function safeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeValue);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => SAFE_FIELDS.has(key))
      .map(([key, item]) => [key, safeValue(item)]),
  );
}

function safeText(value: string): string {
  return value
    .replace(/(token|secret|password|authorization|expression|text)\s*[=:]\s*[^,\s]+/gi, "$1=<redacted>")
    .slice(0, 500);
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.name)) return error.name;
  return "INTERNAL_ERROR";
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  for (const item of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, item.name);
    total += item.isDirectory() ? await directorySize(path) : (await stat(path)).size;
  }
  return total;
}

export class DiagnosticRecorder {
  readonly root: string;
  readonly now: () => number;
  readonly archiveLimitBytes: number;
  #active: DiagnosticSummary | null = null;

  constructor(root = defaultRoot(), options: Options = {}) {
    this.root = root;
    this.now = options.now ?? Date.now;
    this.archiveLimitBytes = options.archiveLimitBytes ?? DEFAULT_ARCHIVE_LIMIT_BYTES;
  }

  async start(name: string): Promise<DiagnosticRun> {
    await this.cleanup();
    const runId = randomUUID();
    const directory = join(this.root, "runs", runId);
    const summary: DiagnosticSummary = { runId, name, startedAt: new Date(this.now()).toISOString(), directory, entryCount: 0 };
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
    this.#active = summary;
    return summary;
  }

  async record(tool: string, args: unknown[], result: unknown, durationMs?: number): Promise<void> {
    if (!this.#active) return;
    const entry: DiagnosticEntry = {
      at: new Date(this.now()).toISOString(),
      tool,
      args: safeValue(args),
      outcome: "ok",
      result: safeValue(result),
      durationMs,
    };
    await this.#append(entry);
  }

  async recordError(tool: string, args: unknown[], error: unknown, durationMs?: number): Promise<void> {
    if (!this.#active) return;
    const typed = error instanceof Error ? error : new Error(String(error));
    const entry: DiagnosticEntry = {
      at: new Date(this.now()).toISOString(),
      tool,
      args: safeValue(args),
      outcome: "error",
      durationMs,
      error: { code: errorCode(error), message: safeText(typed.message) },
    };
    await this.#append(entry);
  }

  async status() {
    const archiveBytes = await directorySize(join(this.root, "archives"));
    return { activeRun: this.#active, root: this.root, archiveBytes, storageWarning: archiveBytes > this.archiveLimitBytes };
  }

  async report(runId?: string) {
    const id = runId ?? this.#active?.runId;
    if (!id || !RUN_ID.test(id)) throw new Error("Invalid diagnostic run ID");
    const live = await this.#readLiveRun(id).catch(() => null);
    const archived = live ? null : await this.#readArchivedRun(id);
    if (!live && !archived) throw new Error("Diagnostic run was not found");
    const { summary, entries } = live ?? archived!;
    const failures = entries.filter((entry) => entry.outcome === "error");
    return {
      summary,
      overview: {
        result: failures.length ? "failed" : "ok",
        failedStep: failures.at(-1)?.tool ?? null,
        error: failures.at(-1)?.error ?? null,
        entryCount: entries.length,
      },
      entries: entries.slice(-200),
    };
  }

  async finish() {
    if (!this.#active) throw new Error("No diagnostic run is active");
    this.#active.endedAt = new Date(this.now()).toISOString();
    await writeFile(join(this.#active.directory, "summary.json"), JSON.stringify(this.#active, null, 2), "utf8");
    const completed = this.#active;
    this.#active = null;
    return completed;
  }

  async cleanup() {
    const runs = join(this.root, "runs");
    const archivedRunIds: string[] = [];
    for (const item of await readdir(runs, { withFileTypes: true }).catch(() => [])) {
      if (!item.isDirectory() || item.name === this.#active?.runId) continue;
      const directory = join(runs, item.name);
      const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8").catch(() => "{}")) as DiagnosticSummary;
      if (!summary.startedAt || this.now() - new Date(summary.startedAt).getTime() < 14 * DAY_MS) continue;
      const month = summary.startedAt.slice(0, 7);
      const archiveDirectory = join(this.root, "archives", month);
      await mkdir(archiveDirectory, { recursive: true });
      const archive = join(archiveDirectory, item.name + ".json.gz");
      const payload = JSON.stringify({ summary, files: await readRunFiles(directory) });
      const compressed = gzipSync(payload);
      const checksum = createHash("sha256").update(compressed).digest("hex");
      const temporary = archive + ".tmp";
      await writeFile(temporary, compressed);
      if (createHash("sha256").update(await readFile(temporary)).digest("hex") !== checksum) {
        throw new Error("Diagnostic archive checksum verification failed");
      }
      await rename(temporary, archive);
      await appendFile(join(this.root, "archive-index.jsonl"), JSON.stringify({
        runId: summary.runId,
        startedAt: summary.startedAt,
        archive,
        checksum,
        entryCount: summary.entryCount,
      }) + "\n", "utf8");
      await rm(directory, { recursive: true, force: true });
      archivedRunIds.push(item.name);
    }
    const archiveBytes = await directorySize(join(this.root, "archives"));
    return { archivedRunIds, archiveBytes, storageWarning: archiveBytes > this.archiveLimitBytes };
  }

  async #append(entry: DiagnosticEntry) {
    if (!this.#active) return;
    this.#active.entryCount += 1;
    await appendFile(join(this.#active.directory, "trace.jsonl"), JSON.stringify(entry) + "\n", "utf8");
    await writeFile(join(this.#active.directory, "summary.json"), JSON.stringify(this.#active, null, 2), "utf8");
  }

  async #readLiveRun(runId: string) {
    const directory = join(this.root, "runs", runId);
    const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8")) as DiagnosticSummary;
    const trace = await readFile(join(directory, "trace.jsonl"), "utf8").catch(() => "");
    return { summary, entries: parseTrace(trace) };
  }

  async #readArchivedRun(runId: string) {
    const index = await readFile(join(this.root, "archive-index.jsonl"), "utf8").catch(() => "");
    const records = index.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { runId: string; archive: string; checksum: string });
    const record = [...records].reverse().find((item) => item.runId === runId);
    if (!record) return null;
    const compressed = await readFile(record.archive);
    if (createHash("sha256").update(compressed).digest("hex") !== record.checksum) {
      throw new Error("Diagnostic archive checksum mismatch");
    }
    const archived = JSON.parse(gunzipSync(compressed).toString("utf8")) as { summary: DiagnosticSummary; files: Record<string, string> };
    return { summary: archived.summary, entries: parseTrace(Buffer.from(archived.files["trace.jsonl"] ?? "", "base64").toString("utf8")) };
  }
}

function parseTrace(trace: string): DiagnosticEntry[] {
  return trace.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as DiagnosticEntry);
}

async function readRunFiles(directory: string, prefix = ""): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? join(prefix, item.name) : item.name;
    const path = join(directory, item.name);
    if (item.isDirectory()) Object.assign(files, await readRunFiles(path, relative));
    else files[relative] = (await readFile(path)).toString("base64");
  }
  return files;
}
