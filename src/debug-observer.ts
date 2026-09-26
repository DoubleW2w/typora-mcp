import type { ConsoleMessage, Page, Request, Response } from "playwright-core";
import { DebugEventBuffer, type DebugEvent, type DebugEventType } from "./debug-events.js";

export interface EventReadOptions {
  targetId?: string;
  afterSeq?: number;
  limit?: number;
}

export interface NetworkReadOptions extends EventReadOptions {
  urlPattern?: string;
  includeBodies?: boolean;
  maxBodyChars?: number;
}

export class DebugObserver {
  readonly #events: DebugEventBuffer;
  readonly #attached = new WeakSet<Page>();
  readonly #requestIds = new WeakMap<Request, string>();
  readonly #startedAt = new WeakMap<Request, number>();
  readonly #responses = new Map<string, { targetId: string; response: Response }>();
  #nextRequestId = 1;

  constructor(events = new DebugEventBuffer()) {
    this.#events = events;
  }

  attach(page: Page, targetId: string): void {
    if (this.#attached.has(page)) return;
    this.#attached.add(page);
    page.on("console", (message) => void this.#recordConsole(targetId, message));
    page.on("pageerror", (error) => {
      this.#events.push({
        targetId,
        type: "javascript-error",
        payload: { name: error.name, message: error.message, stack: error.stack ?? null },
      });
    });
    page.on("request", (request) => this.#recordRequest(targetId, request));
    page.on("response", (response) => this.#recordResponse(targetId, response));
    page.on("requestfailed", (request) => this.#recordFailure(targetId, request));
  }

  console(options: EventReadOptions & { levels?: string[] } = {}) {
    const requestedLimit = options.limit ?? 100;
    const result = this.#events.query({ ...options, types: ["console"], limit: 10_000 });
    const matching = options.levels
      ? result.events.filter((event) => options.levels!.includes(String(event.payload.level)))
      : result.events;
    const events = matching.slice(0, requestedLimit);
    return { ...result, events, truncated: result.truncated || matching.length > events.length };
  }

  errors(options: EventReadOptions = {}) {
    return this.#query("javascript-error", options);
  }

  async network(options: NetworkReadOptions = {}) {
    const requestedLimit = options.limit ?? 100;
    const base = this.#events.query({
      targetId: options.targetId,
      afterSeq: options.afterSeq,
      types: ["network"],
      limit: 10_000,
    });
    const matching = base.events.filter(
      (event) => !options.urlPattern || String(event.payload.url).includes(options.urlPattern),
    );
    const events = matching
      .slice(0, requestedLimit)
      .map((event) => ({ ...event, payload: { ...event.payload } }));
    if (options.includeBodies) {
      await Promise.all(events.map((event) => this.#addBody(event, options.maxBodyChars ?? 20_000)));
    }
    return { ...base, events, truncated: base.truncated || matching.length > events.length };
  }

  latestSeq(): number {
    return this.#events.query({ limit: 0 }).latestSeq;
  }

  clear(targetId?: string): void {
    this.#events.clear(targetId);
    for (const [requestId, value] of this.#responses) {
      if (!targetId || value.targetId === targetId) this.#responses.delete(requestId);
    }
  }

  #query(type: DebugEventType, options: EventReadOptions) {
    return this.#events.query({ ...options, types: [type] });
  }

  async #recordConsole(targetId: string, message: ConsoleMessage): Promise<void> {
    const args = await Promise.all(
      message.args().map(async (argument) => {
        try {
          return await argument.jsonValue();
        } catch {
          return argument.toString();
        }
      }),
    );
    this.#events.push({
      targetId,
      type: "console",
      payload: { level: message.type(), text: message.text(), args, location: message.location() },
    });
  }

  #idFor(request: Request): string {
    let requestId = this.#requestIds.get(request);
    if (!requestId) {
      requestId = `request-${this.#nextRequestId++}`;
      this.#requestIds.set(request, requestId);
    }
    return requestId;
  }

  #recordRequest(targetId: string, request: Request): void {
    const requestId = this.#idFor(request);
    this.#startedAt.set(request, performance.now());
    this.#events.push({
      targetId,
      type: "network",
      payload: {
        requestId,
        phase: "request",
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        postData: request.postData(),
      },
    });
  }

  #recordResponse(targetId: string, response: Response): void {
    const request = response.request();
    const requestId = this.#idFor(request);
    this.#responses.set(requestId, { targetId, response });
    if (this.#responses.size > 1_000) this.#responses.delete(this.#responses.keys().next().value!);
    this.#events.push({
      targetId,
      type: "network",
      payload: {
        requestId,
        phase: "response",
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        timingMs: this.#elapsed(request),
      },
    });
  }

  #recordFailure(targetId: string, request: Request): void {
    this.#events.push({
      targetId,
      type: "network",
      payload: {
        requestId: this.#idFor(request),
        phase: "failed",
        url: request.url(),
        errorText: request.failure()?.errorText ?? "unknown",
        timingMs: this.#elapsed(request),
      },
    });
  }

  #elapsed(request: Request): number | null {
    const startedAt = this.#startedAt.get(request);
    return startedAt === undefined ? null : Math.round((performance.now() - startedAt) * 100) / 100;
  }

  async #addBody(event: DebugEvent, maxBodyChars: number): Promise<void> {
    const requestId = String(event.payload.requestId ?? "");
    const stored = this.#responses.get(requestId);
    if (!stored || event.payload.phase !== "response") return;
    try {
      const body = await stored.response.body();
      const contentType = stored.response.headers()["content-type"] ?? "";
      const textLike = /(^text\/|json|javascript|xml|html|css)/i.test(contentType);
      const encoded = textLike ? body.toString("utf8") : body.toString("base64");
      event.payload.body = encoded.slice(0, maxBodyChars);
      event.payload.bodyEncoding = textLike ? "utf8" : "base64";
      event.payload.bodyTruncated = encoded.length > maxBodyChars;
    } catch (error) {
      event.payload.bodyError = error instanceof Error ? error.message : String(error);
    }
  }
}
