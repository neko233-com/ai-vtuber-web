import { describe, expect, it, vi } from "vite-plus/test";
import { Reactor } from "../src/core/Reactor";
import type { Frame, PlayerLike, Reaction } from "../src/types";

/** Player stub that records driver adds and expression calls. */
function makePlayer() {
  let driver: ((f: Frame) => void) | null = null;
  const exprCalls: { id: string | null; weight?: number }[] = [];
  const acts: string[] = [];
  const blinks: number[] = [];
  const pokes: { x: number; y: number; strength?: number }[] = [];
  const player: PlayerLike = {
    params: {},
    expressions: [{ id: "smile" }, { id: "shy" }, { id: "surprised" }],
    setExpression: vi.fn((id: string | null, weight?: number) => {
      exprCalls.push({ id, weight });
      return true;
    }),
    act: vi.fn((id: string) => acts.push(id)),
    blink: vi.fn(() => blinks.push(1)),
    use: vi.fn((d: { update(f: Frame): void }) => {
      driver = d.update;
      return () => {
        driver = null;
      };
    }),
    poke: vi.fn((x: number, y: number, strength?: number) => {
      pokes.push({ x, y, strength });
      return 1;
    }),
  };
  const lastAdds: Record<string, number> = {};
  /** One 16 ms rAF frame at the reactor's own clock. */
  const tick = () => {
    const adds: Record<string, number> = {};
    driver?.({ time: 0, dt: 16, add: (o) => Object.assign(adds, o) });
    for (const [k, v] of Object.entries(adds)) lastAdds[k] = v;
    return adds;
  };
  /** Advance the simulated clock, returning the last frame's offsets. */
  const advance = (ms: number) => {
    let last: Record<string, number> = {};
    for (let done = 0; done < ms; done += 16) last = tick();
    return last;
  };
  return {
    player,
    exprCalls,
    acts,
    blinks,
    pokes,
    tick,
    advance,
    lastAdds,
    hasDriver: () => driver !== null,
  };
}

describe("Reactor", () => {
  it("registers exactly one driver on construction", () => {
    const p = makePlayer();
    new Reactor(p.player);
    expect(p.hasDriver()).toBe(true);
    expect(p.player.use).toHaveBeenCalledOnce();
  });

  it("holds offsets, then decays linearly to zero", () => {
    const p = makePlayer();
    const r = new Reactor(p.player);
    r.apply({ params: { browLY: 0.4 }, holdMs: 1000, decayMs: 1000 });

    expect(p.advance(500).browLY).toBeCloseTo(0.4); // holding
    expect(p.advance(400).browLY).toBeCloseTo(0.4); // still holding
    // decay ends at 2000; last frame inside it (~1984) is ~1.6% left
    const duringDecay = p.advance(400).browLY;
    expect(duringDecay).toBeGreaterThan(0);
    expect(duringDecay).toBeLessThan(0.4);
    p.advance(700); // past 2100: done
    expect(p.advance(16)).toEqual({}); // no offsets anymore
  });

  it("uses holdMs/decayMs defaults when omitted", () => {
    const p = makePlayer();
    const r = new Reactor(p.player);
    r.apply({ params: { eyeBallX: 0.5 } }); // hold 900 + decay 600
    expect(p.advance(800).eyeBallX).toBeCloseTo(0.5);
    const mid = p.advance(300).eyeBallX; // 1100: inside decay (900..1500)
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.5);
    p.advance(500); // past 1500
    expect(p.advance(16)).toEqual({}); // no offsets anymore
  });

  it("new apply interrupts decay smoothly", () => {
    const p = makePlayer();
    const r = new Reactor(p.player);
    r.apply({ params: { browLY: 0.4 }, holdMs: 200, decayMs: 1000 });
    p.tick();
    p.advance(600);
    const midDecay = p.lastAdds.browLY;
    expect(midDecay).toBeGreaterThan(0);
    expect(midDecay).toBeLessThan(0.4);
    r.apply({ params: { browLY: 0.6 }, holdMs: 500, decayMs: 500 });
    expect(p.tick().browLY).toBeCloseTo(0.6); // reset to new hold
    expect(p.advance(400).browLY).toBeCloseTo(0.6);
    const late = p.advance(400).browLY; // ~800 into new reaction: decaying
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(0.6);
  });

  it("restores neutral expression once after decay completes", () => {
    const p = makePlayer();
    const r = new Reactor(p.player);
    r.apply({ expression: "surprised", holdMs: 300, decayMs: 200 });
    expect(p.exprCalls.at(-1)!.id).toBe("surprised");
    p.advance(400); // inside decay window
    const before = p.exprCalls.length;
    p.advance(200); // past 500 → restore fires
    expect(p.exprCalls.length).toBe(before + 1);
    expect(p.exprCalls.at(-1)!.id).toBeNull();
    p.advance(300);
    expect(p.exprCalls.length).toBe(before + 1); // no repeat
  });

  it("degrades to smile param when the model lacks the expression", () => {
    const p = makePlayer();
    // mockImplementationOnce keeps the recorder while faking "no such expression"
    vi.mocked(p.player.setExpression).mockImplementationOnce((id) => {
      p.exprCalls.push({ id, weight: 1 });
      return false;
    });
    const r = new Reactor(p.player);
    r.apply({ expression: "shy", weight: 1, holdMs: 300, decayMs: 200 });
    expect(p.exprCalls.at(-1)!.id).toBe("shy"); // still attempted
    expect(p.tick().smile).toBeCloseTo(0.8); // fallback param
    p.advance(700); // reaction done
    expect(p.exprCalls.length).toBe(1); // no restore-to-null was scheduled
  });

  it("forwards act, blink and poke", () => {
    const p = makePlayer();
    const r = new Reactor(p.player);
    r.apply({ act: "hop", blink: true, poke: { x: 10, y: 20, strength: 2 } });
    expect(p.acts).toEqual(["hop"]);
    expect(p.blinks.length).toBe(1);
    expect(p.pokes).toEqual([{ x: 10, y: 20, strength: 2 }]);
  });

  it("dispose removes the driver", () => {
    const p = makePlayer();
    const r = new Reactor(p.player);
    r.dispose();
    expect(p.hasDriver()).toBe(false);
    r.apply({ params: { browLY: 1 } });
    expect(p.tick()).toEqual({});
  });

  it("accepts an empty reaction without touching the player", () => {
    const p = makePlayer();
    const r = new Reactor(p.player);
    const exprBefore = p.exprCalls.length;
    r.apply({} as Reaction);
    expect(p.tick()).toEqual({});
    expect(p.exprCalls.length).toBe(exprBefore);
  });
});
