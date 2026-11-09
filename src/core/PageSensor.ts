import type { PageEvent, PresenceEventHooks } from "../types";

export interface PageSensorOptions extends PresenceEventHooks {
  /** Anything with add/removeEventListener + interval fns; defaults to window. */
  root?: MinimalEventTarget;
  /** Idle threshold. Default 15000. */
  idleAfterMs?: number;
  /** Idle check interval. Default 1000. */
  intervalMs?: number;
  /** Per-event-type switches. Default: all on. */
  events?: {
    click?: boolean;
    hover?: boolean;
    scroll?: boolean;
    pointerMove?: boolean;
    idle?: boolean;
  };
  /** Injectable clock for tests. */
  now?: () => number;
}

interface MinimalEventTarget {
  addEventListener(type: string, fn: (e: any) => void, opts?: AddEventListenerOptions): void;
  removeEventListener(type: string, fn: (e: any) => void, opts?: AddEventListenerOptions): void;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
}

interface TargetSummaryInput {
  tagName?: string;
  id?: string;
  className?: string;
  textContent?: string;
}

const INTERACTIVE = "a,button,[data-vtuber-reactive]";
const SCROLL_THROTTLE_MS = 300;
const MOVE_THROTTLE_MS = 250;
const TEXT_LIMIT = 80;

function summarize(target: unknown): PageEvent["target"] {
  const el = target as TargetSummaryInput | null;
  if (!el || typeof el !== "object") return undefined;
  const classes =
    typeof el.className === "string" && el.className.trim() !== ""
      ? el.className.trim().split(/\s+/).slice(0, 3)
      : undefined;
  const text =
    typeof el.textContent === "string" && el.textContent.trim() !== ""
      ? el.textContent.trim().slice(0, TEXT_LIMIT)
      : undefined;
  return {
    tag: (el.tagName ?? "unknown").toLowerCase(),
    id: el.id || undefined,
    classes,
    text,
  };
}

/**
 * Turns DOM activity into typed PageEvents: clicks, hover enter/leave on
 * interactive elements, wheel scroll, throttled pointer moves, and idle ticks.
 */
export class PageSensor {
  /** Exposed for tests. */
  readonly intervalMsForTest: number;
  private root: MinimalEventTarget;
  private opts: PageSensorOptions;
  private lastActivity: number;
  private idleFired = false;
  private lastScroll = -Infinity;
  private lastMove = -Infinity;
  private lastMovePos: { x: number; y: number; t: number } | null = null;
  private hovered = false;
  private disposed = false;
  private handlers: { type: string; fn: (e: any) => void }[] = [];
  private timerId: number;

  constructor(opts: PageSensorOptions = {}) {
    this.opts = opts;
    const now = opts.now ?? Date.now;
    this.lastActivity = now();
    // Fallback to globals when no root given (browser default).
    this.root =
      opts.root ??
      ({
        addEventListener: (t, fn, o) => window.addEventListener(t, fn, o),
        removeEventListener: (t, fn, o) => window.removeEventListener(t, fn, o),
        setInterval: (fn, ms) => window.setInterval(fn, ms),
        clearInterval: (id) => window.clearInterval(id),
      } as MinimalEventTarget);

    const enabled = {
      click: true,
      hover: true,
      scroll: true,
      pointerMove: true,
      idle: true,
      ...opts.events,
    };
    this.intervalMsForTest = opts.intervalMs ?? 1000;

    const on = (type: string, fn: (e: any) => void) => {
      this.root.addEventListener(type, fn, { passive: true });
      this.handlers.push({ type, fn });
    };

    if (enabled.click) {
      on("click", (e) => {
        this.activity();
        this.emit({
          type: "click",
          target: summarize(e.target),
          x: typeof e.clientX === "number" ? e.clientX : undefined,
          y: typeof e.clientY === "number" ? e.clientY : undefined,
        });
      });
    }

    if (enabled.hover) {
      on("pointerover", (e) => {
        if (this.hovered) return;
        const el = e.target;
        const interactive =
          el && typeof el.closest === "function" ? Boolean(el.closest(INTERACTIVE)) : false;
        if (!interactive) return;
        this.hovered = true;
        this.activity();
        this.emit({ type: "hover-enter", target: summarize(el) });
      });
      on("pointerout", (e) => {
        if (!this.hovered) return;
        const el = e.target;
        const interactive =
          el && typeof el.closest === "function" ? Boolean(el.closest(INTERACTIVE)) : false;
        if (!interactive) return;
        this.hovered = false;
        this.emit({ type: "hover-leave", target: summarize(el) });
      });
    }

    if (enabled.scroll) {
      on("wheel", (e) => {
        this.activity();
        const t = now();
        if (t - this.lastScroll < SCROLL_THROTTLE_MS) return;
        this.lastScroll = t;
        this.emit({ type: "scroll", deltaY: typeof e.deltaY === "number" ? e.deltaY : 0 });
      });
    }

    if (enabled.pointerMove) {
      on("pointermove", (e) => {
        this.activity();
        const t = now();
        if (t - this.lastMove < MOVE_THROTTLE_MS) return;
        this.lastMove = t;
        const x = typeof e.clientX === "number" ? e.clientX : 0;
        const y = typeof e.clientY === "number" ? e.clientY : 0;
        if (this.lastMovePos) {
          const dt = Math.max(1, t - this.lastMovePos.t);
          const dist = Math.hypot(x - this.lastMovePos.x, y - this.lastMovePos.y);
          this.emit({ type: "pointer-move", x, y, pointerSpeed: (dist / dt) * 1000 });
        }
        this.lastMovePos = { x, y, t };
      });
    }

    if (enabled.idle) {
      const interval = this.intervalMsForTest;
      this.timerId = this.root.setInterval(() => {
        const t = now();
        const idleMs = t - this.lastActivity;
        if (idleMs >= (opts.idleAfterMs ?? 15000)) {
          if (!this.idleFired) {
            this.idleFired = true;
            this.emit({ type: "idle", idleMs });
          } else {
            // keep nudging every threshold so strategies can escalate
            this.emit({ type: "idle", idleMs });
          }
        }
      }, interval);
    } else {
      this.timerId = 0;
    }
  }

  /** Mark activity (resets idle). Public for hosts that inject activity. */
  activity(): void {
    this.lastActivity = this.opts.now?.() ?? Date.now();
    this.idleFired = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { type, fn } of this.handlers) {
      this.root.removeEventListener(type, fn);
    }
    this.handlers = [];
    if (this.timerId) this.root.clearInterval(this.timerId);
  }

  private emit(event: PageEvent): void {
    this.opts.onEvent?.(event);
  }
}
