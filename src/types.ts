/**
 * Core public types of ai-vtuber-web.
 *
 * The library is provider-agnostic: it never imports `@livliv-dev/player`.
 * Anything shaped like `PlayerLike` works — `Player`, `BodyPlayer` (VRM /
 * PNGTuber), or your own mock.
 */

export type PresenceMode = "rules" | "agent" | (string & {});

export interface EventTargetSummary {
  tag: string;
  id?: string;
  classes?: string[];
  /** textContent trimmed and truncated to 80 chars. */
  text?: string;
}

export type PageEventType =
  | "click"
  | "hover-enter"
  | "hover-leave"
  | "scroll"
  | "pointer-move"
  | "idle";

export interface PageEvent {
  type: PageEventType;
  target?: EventTargetSummary;
  /** CSS px from the viewport top-left, when meaningful. */
  x?: number;
  y?: number;
  /** px/s of pointer travel, `pointer-move` only. */
  pointerSpeed?: number;
  /** wheel scroll direction/magnitude, `scroll` only. */
  deltaY?: number;
  /** how long the page has been idle, `idle` only. */
  idleMs?: number;
}

/**
 * What a strategy decides to do. Everything is optional; an empty object is
 * a valid (no-op) reaction the reactor simply ignores.
 */
export interface Reaction {
  /** Expression id from `player.expressions`; `null` returns to neutral. */
  expression?: string | null;
  /** 0..1, default 1. */
  weight?: number;
  /** Short move: 'nod' | 'shake' | 'tilt' | 'hop' | 'shy' (or model-specific). */
  act?: string;
  blink?: boolean;
  /** Per-frame param offsets layered on top of idle via the player driver. */
  params?: Record<string, number>;
  poke?: { x: number; y: number; strength?: number };
  /** Optional line for the host page to speak (TTS is out of scope here). */
  say?: string;
  /** Keep the applied offsets for this long before decaying. Default 900. */
  holdMs?: number;
  /** Linear decay back to zero over this long. Default 600. */
  decayMs?: number;
}

export interface StrategyContext {
  player: PlayerLike;
}

export interface Strategy {
  name: string;
  /** May return a Reaction, null (no reaction), or a promise of either. */
  decide(event: PageEvent): Reaction | null | Promise<Reaction | null>;
  init?(ctx: StrategyContext): void | Promise<void>;
  dispose?(): void;
}

/** Minimal structural surface of a LivLiv Player / BodyPlayer. */
export interface PlayerLike {
  setExpression(id: string | null, weight?: number): boolean;
  act(id: string): void;
  blink(): void;
  params: Record<string, number>;
  /** Register a per-frame driver; returns its remover. */
  use(driver: { update(frame: Frame): void }): () => void;
  poke?(x: number, y: number, strength?: number): number;
  expressions?: { id: string }[];
}

/** Frame handed to a LivLiv driver each rAF tick. */
export interface Frame {
  dt: number;
  time: number;
  add(offsets: Record<string, number>): void;
}

/** LiveLiv param ranges (API.md "params"). */
export const PARAM_RANGES: Record<string, [number, number]> = {
  angleX: [-30, 30],
  angleY: [-30, 30],
  angleZ: [-30, 30],
  eyeLOpen: [0, 1],
  eyeROpen: [0, 1],
  eyeBallX: [-1, 1],
  eyeBallY: [-1, 1],
  browLY: [-1, 1],
  browRY: [-1, 1],
  mouthOpen: [0, 1],
  vowel: [-1, 1],
  smile: [0, 1],
  bodyX: [-10, 10],
  bodyZ: [-10, 10],
  breath: [0, 1],
};

/** Standard short actions accepted by `player.act()`. */
export const ACT_IDS = ["nod", "shake", "tilt", "hop", "shy"] as const;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** User-supplied LLM hook (OpenAI-compatible or anything else). */
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

export interface AgentConfig {
  chat: ChatFn;
  /** Give up and fall back to rules after this long. Default 4000. */
  timeoutMs?: number;
  /** Rolling memory of recent events sent to the model. Default 3. */
  recentSize?: number;
  /** Character display name used in the prompt. */
  characterName?: string;
}

export interface PresenceEventHooks {
  onEvent?(event: PageEvent): void;
  onReaction?(reaction: Reaction, event: PageEvent): void;
  onSay?(text: string): void;
  onError?(err: unknown): void;
}

export interface LivePresenceConfig extends PresenceEventHooks {
  /** Default 'auto': agent when `agent` is configured, else rules. */
  mode?: PresenceMode;
  agent?: AgentConfig;
  /** Per-event rule overrides for RuleStrategy; `null` disables an event. */
  rules?: RuleOverrides;
  events?: {
    click?: boolean;
    hover?: boolean;
    scroll?: boolean;
    pointerMove?: boolean;
    idle?: boolean;
  };
  throttle?: { minIntervalMs?: number; maxPerMin?: number };
  /** Idle threshold. Default 15000. */
  idleAfterMs?: number;
  /** Selector marking the VTuber canvas, for canvas-specific click rules. */
  canvasSelector?: string;
  /** Injectable clock for tests. */
  now?: () => number;
}

export type RuleOverrides = Partial<Record<PageEventType, RuleEntry[] | null>>;

/** One rule table entry. `reaction` may be a factory receiving the event. */
export interface RuleEntry {
  /** Optional predicate; entry only considered when it returns true. */
  match?: (event: PageEvent) => boolean;
  reaction: Reaction | ((event: PageEvent) => Reaction);
  cooldownMs?: number;
}
