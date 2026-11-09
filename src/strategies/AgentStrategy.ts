import type {
  AgentConfig,
  ChatMessage,
  ChatFn,
  PageEvent,
  PlayerLike,
  Reaction,
  Strategy,
} from "../types";
import { ACT_IDS, PARAM_RANGES } from "../types";
import { clamp } from "../util/clamp";

const SYSTEM_PROMPT = `You are the behavior brain of a web VTuber character.
You receive page events (clicks, hovers, scroll, idle time) and decide how the
character reacts so it feels alive.
Respond with ONLY one JSON object, no prose, no markdown fences:
  {"expression": "<id|null>", "act": "<id|null>", "params": {"<param>": number},
   "say": "<short line or omit>", "holdMs": <number, 200-2000>}
Rules:
- "expression" must be one of the listed expression ids, or null.
- "act" must be one of: nod, shake, tilt, hop, shy, or null.
- "params" keys must be from the listed param names; values stay in range.
- Be expressive but restrained: not every event deserves a big reaction.`;

export interface AgentStrategyOptions extends AgentConfig {
  fallback: Strategy;
  /** LivLiv player for expression whitelist; optional. */
  player?: PlayerLike;
  /** Or pass the expression list directly (takes precedence). */
  expressions?: { id: string }[];
  now?: () => number;
}

interface ParsedReply {
  expression?: string | null;
  act?: string | null;
  params?: Record<string, unknown>;
  say?: string;
  holdMs?: number;
}

function stripFences(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

function extractJson(text: string): ParsedReply | null {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned) as ParsedReply;
  } catch {
    // tolerate prose around a JSON object
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as ParsedReply;
    } catch {
      return null;
    }
  }
}

export class AgentStrategy implements Strategy {
  name = "agent";
  private chat: ChatFn;
  private fallback: Strategy;
  private timeoutMs: number;
  private recentSize: number;
  private characterName?: string;
  private expressionIds: ReadonlySet<string>;
  private recent: { event: string; decided: string }[] = [];
  private inFlight = false;
  private now: () => number;

  constructor(opts: AgentStrategyOptions) {
    this.chat = opts.chat;
    this.fallback = opts.fallback;
    this.timeoutMs = opts.timeoutMs ?? 4000;
    this.recentSize = opts.recentSize ?? 3;
    this.characterName = opts.characterName;
    this.now = opts.now ?? Date.now;
    this.expressionIds = new Set(
      (opts.expressions ?? opts.player?.expressions ?? []).map((e) => e.id),
    );
  }

  async decide(event: PageEvent): Promise<Reaction | null> {
    // One request at a time: a burst of events is handled by the rules brain.
    if (this.inFlight) return this.fallback.decide(event);

    this.inFlight = true;
    try {
      const messages = this.buildMessages(event);
      const reply = await withTimeout(this.chat(messages), this.timeoutMs, this.now);
      const parsed = extractJson(reply);
      if (!parsed) throw new Error("agent reply is not valid JSON");
      const reaction = this.validate(parsed, event);
      this.remember(event, reaction);
      return reaction;
    } catch {
      // Timeout, network error, bad JSON — degrade gracefully.
      return this.fallback.decide(event);
    } finally {
      this.inFlight = false;
    }
  }

  dispose(): void {
    this.recent = [];
  }

  /** Expression whitelist: any id when the player is unknown, else known ids. */
  private expressionAllowed(id: string): boolean {
    if (this.expressionIds.size === 0) {
      return /^[\w-]+$/.test(id); // unknown player: allow standard-ish ids
    }
    return this.expressionIds.has(id);
  }

  private buildMessages(event: PageEvent): ChatMessage[] {
    const system =
      SYSTEM_PROMPT +
      `\n- Available expressions: ${
        this.expressionIds.size > 0
          ? [...this.expressionIds].join(", ")
          : "smile, shy, angry, sad, surprised (standard ids)"
      }` +
      `\n- Param names: ${Object.keys(PARAM_RANGES).join(", ")}` +
      (this.characterName ? `\n- Character name: ${this.characterName}` : "");

    const payload = [
      `Event: ${describeEvent(event)}`,
      ...this.recent.map((r, i) => `[${i}] earlier event ${r.event} -> decided ${r.decided}`),
      "Decide the next reaction. JSON only.",
    ].join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: payload },
    ];
    return messages;
  }

  private remember(event: PageEvent, reaction: Reaction): void {
    this.recent.push({
      event: describeEvent(event),
      decided: describeReaction(reaction),
    });
    while (this.recent.length > this.recentSize) this.recent.shift();
  }

  /** Whitelist validation: unknown fields dropped, params clamped. */
  private validate(parsed: ParsedReply, event: PageEvent): Reaction | null {
    const r: Reaction = {};

    if (
      (parsed.expression === null || typeof parsed.expression === "string") &&
      (parsed.expression === null || this.expressionAllowed(parsed.expression))
    ) {
      r.expression = parsed.expression;
    }
    if (typeof parsed.act === "string" && (ACT_IDS as readonly string[]).includes(parsed.act)) {
      r.act = parsed.act;
    }
    if (parsed.params && typeof parsed.params === "object") {
      const params: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed.params)) {
        const range = PARAM_RANGES[k];
        if (!range || typeof v !== "number" || !Number.isFinite(v)) continue;
        params[k] = clamp(v, range[0], range[1]);
      }
      if (Object.keys(params).length > 0) r.params = params;
    }
    if (typeof parsed.say === "string" && parsed.say.length > 0 && parsed.say.length <= 200) {
      r.say = parsed.say;
    }
    if (typeof parsed.holdMs === "number" && Number.isFinite(parsed.holdMs)) {
      r.holdMs = clamp(parsed.holdMs, 200, 2000);
    }

    const empty =
      r.expression === undefined &&
      r.act === undefined &&
      r.params === undefined &&
      r.say === undefined;
    // A fully-empty or fully-rejected decision means "no reaction"…
    if (empty && parsed.expression !== null) {
      // …unless the model explicitly chose neutral: keep going through rules.
      return this.fallback.decide(event);
    }
    return r;
  }
}

function describeEvent(event: PageEvent): string {
  const target = event.target
    ? ` on ${event.target.tag}${event.target.id ? "#" + event.target.id : ""}${
        event.target.text ? ` "${event.target.text}"` : ""
      }`
    : "";
  const extras: string[] = [];
  if (event.deltaY !== undefined) extras.push(`deltaY=${event.deltaY}`);
  if (event.pointerSpeed !== undefined) extras.push(`speed=${Math.round(event.pointerSpeed)}px/s`);
  if (event.idleMs !== undefined) extras.push(`idle=${Math.round(event.idleMs)}ms`);
  return `${event.type}${target}${extras.length > 0 ? " (" + extras.join(", ") + ")" : ""}`;
}

function describeReaction(r: Reaction): string {
  const parts: string[] = [];
  if (r.expression) parts.push(`expression=${r.expression}`);
  if (r.act) parts.push(`act=${r.act}`);
  if (r.params) parts.push(`params=${JSON.stringify(r.params)}`);
  if (r.say) parts.push(`say="${r.say}"`);
  return parts.length > 0 ? parts.join(" ") : "neutral";
}

function withTimeout<T>(p: Promise<T>, ms: number, now: () => number): Promise<T> {
  // Real timers; `now` kept for symmetry with injectable clocks in tests.
  void now;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("agent timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Silence an unused-import lint if the type is only referenced in docs.
export type { PlayerLike };
