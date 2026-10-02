import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export interface Fixture {
  version: 1;
  document: string;
  waits?: Array<
    | { type: "selector" | "text"; value: string; timeoutMs?: number }
    | { type: "event"; eventType: string; afterSeq?: number; timeoutMs?: number }
  >;
  actions?: Array<
    | { type: "click"; selector: string }
    | { type: "pressKey"; key: string; selector?: string }
    | { type: "scroll"; selector?: string; deltaY: number; deltaX?: number }
    | { type: "type"; selector: string; text: string; clear?: boolean }
    | { type: "networkProbe" }
  >;
  assertions?: Array<
    | { type: "sourceUnchanged" }
    | { type: "selectorExists"; selector: string }
    | { type: "styleEquals"; selector: string; property: string; value: string }
    | { type: "event"; eventType: string; afterSeq?: number }
  >;
  evidence?: { screenshot?: boolean };
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !path.includes(".." + sep));
}

export async function readFixture(fixturePath: string, fixtureRoot: string): Promise<{ fixture: Fixture; documentPath: string }> {
  const root = resolve(fixtureRoot);
  const path = resolve(fixturePath);
  if (!within(root, path)) throw new Error("FIXTURE_PATH_FORBIDDEN");
  const fixture = JSON.parse(await readFile(path, "utf8")) as Fixture;
  if (fixture.version !== 1 || typeof fixture.document !== "string") throw new Error("INVALID_FIXTURE");
  const documentPath = resolve(root, fixture.document);
  if (!within(root, documentPath)) throw new Error("FIXTURE_DOCUMENT_FORBIDDEN");
  return { fixture, documentPath };
}

export async function createEvidenceDirectory(root: string): Promise<{ runId: string; directory: string }> {
  const runId = randomUUID();
  const directory = resolve(root, runId);
  await mkdir(directory, { recursive: true });
  return { runId, directory };
}

export async function writeEvidence(directory: string, name: string, value: unknown): Promise<void> {
  await writeFile(resolve(directory, name), JSON.stringify(value, null, 2), "utf8");
}
