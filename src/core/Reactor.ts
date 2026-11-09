import type { Frame, PlayerLike, Reaction } from "../types";

interface ActiveReaction {
  target: Record<string, number>;
  holdMs: number;
  decayMs: number;
  startedAt: number;
  restoreAt: number | null; // time when setExpression(null) is due; null = none
}

/** LivLiv expressions that map onto the `smile` param when missing. */
const SMILE_FALLBACK = new Set(["smile", "shy", "happy"]);

/**
 * Applies Reactions to the player: one persistent driver adds param offsets
 * each frame (hold → linear decay), discrete calls handle expression / act /
 * blink / poke. A new apply smoothly replaces the previous one.
 */
export class Reactor {
  private player: PlayerLike;
  private removeDriver: () => void;
  private active: ActiveReaction | null = null;
  private clock = 0; // driver-frame clock, ms since construction

  constructor(player: PlayerLike) {
    this.player = player;
    this.removeDriver = player.use({
      update: (frame: Frame) => this.tick(frame),
    });
  }

  apply(reaction: Reaction): void {
    const holdMs = reaction.holdMs ?? 900;
    const decayMs = reaction.decayMs ?? 600;

    // Discrete moves fire immediately.
    if (reaction.act) this.player.act(reaction.act);
    if (reaction.blink) this.player.blink();
    if (reaction.poke) this.player.poke?.(reaction.poke.x, reaction.poke.y, reaction.poke.strength);

    let restoreAt: number | null = null;

    if (reaction.expression !== undefined) {
      const weight = reaction.weight ?? 1;
      const ok = this.player.setExpression(reaction.expression, weight);
      if (!ok && reaction.expression !== null) {
        // Model lacks the expression (e.g. PNGTuber): degrade to smile param.
        if (SMILE_FALLBACK.has(reaction.expression)) {
          const target: Record<string, number> = { ...(reaction.params ?? undefined) };
          target.smile = (target.smile ?? 0) + 0.8 * weight;
          reaction = { ...reaction, params: target, expression: undefined };
        } else {
          reaction = { ...reaction, expression: undefined };
        }
      } else if (reaction.expression !== null) {
        // Schedule one restore to neutral after the reaction dies down.
        restoreAt = this.clock + holdMs + decayMs;
      }
    }

    const hasParams = reaction.params && Object.keys(reaction.params).length > 0;
    this.active = {
      target: hasParams ? { ...reaction.params } : {},
      holdMs,
      decayMs,
      startedAt: this.clock,
      restoreAt,
    };
  }

  /** Called by the player driver every frame. */
  private tick(frame: Frame): void {
    this.clock += frame.dt;
    if (!this.active) return;
    const a = this.active;
    const elapsed = this.clock - a.startedAt;

    if (elapsed <= a.holdMs) {
      if (Object.keys(a.target).length > 0) frame.add(a.target);
    } else if (elapsed < a.holdMs + a.decayMs) {
      const p = (elapsed - a.holdMs) / a.decayMs; // 0..1 through decay
      const k = 1 - p;
      const scaled: Record<string, number> = {};
      for (const [kParam, v] of Object.entries(a.target)) scaled[kParam] = v * k;
      frame.add(scaled);
    } else {
      // Done: drop the reaction; expression restore fires once.
      if (a.restoreAt !== null && this.clock >= a.restoreAt) {
        this.player.setExpression(null);
      }
      this.active = null;
    }
  }

  dispose(): void {
    this.removeDriver();
    this.active = null;
  }
}
