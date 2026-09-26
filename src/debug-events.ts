export type DebugEventType = "console" | "javascript-error" | "network";

export interface DebugEvent {
  seq: number;
  timestamp: string;
  targetId: string;
  type: DebugEventType;
  payload: Record<string, unknown>;
}

export interface DebugEventInput {
  targetId: string;
  type: DebugEventType;
  payload: Record<string, unknown>;
  timestamp?: string;
}

export interface DebugEventQuery {
  targetId?: string;
  afterSeq?: number;
  types?: DebugEventType[];
  limit?: number;
}

export class DebugEventBuffer {
  readonly #capacity: number;
  #nextSeq = 1;
  #events: DebugEvent[] = [];

  constructor(capacity = 1_000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be positive");
    this.#capacity = capacity;
  }

  push(input: DebugEventInput): DebugEvent {
    const event: DebugEvent = {
      ...input,
      seq: this.#nextSeq++,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
    this.#events.push(event);
    if (this.#events.length > this.#capacity) this.#events.shift();
    return event;
  }

  query(query: DebugEventQuery = {}) {
    const limit = Math.max(0, query.limit ?? 100);
    const filtered = this.#events.filter(
      (event) =>
        event.seq > (query.afterSeq ?? 0) &&
        (!query.targetId || event.targetId === query.targetId) &&
        (!query.types || query.types.includes(event.type)),
    );
    return {
      events: filtered.slice(0, limit),
      oldestAvailableSeq: this.#events[0]?.seq ?? this.#nextSeq,
      latestSeq: this.#nextSeq - 1,
      truncated: filtered.length > limit,
    };
  }

  clear(targetId?: string): void {
    this.#events = targetId ? this.#events.filter((event) => event.targetId !== targetId) : [];
  }
}
