import { describe, expect, it } from "vite-plus/test";
import { RuleStrategy } from "../src/strategies/RuleStrategy";
import type { PageEvent } from "../src/types";

let t = 0;
const now = () => t;
const tick = (ms: number) => {
  t += ms;
};

const ev = (type: PageEvent["type"], extra: Partial<PageEvent> = {}): PageEvent => ({
  type,
  ...extra,
});

describe("RuleStrategy", () => {
  it("maps click to hop + surprised (canvas)", () => {
    const s = new RuleStrategy({ now });
    const r = s.decide(ev("click", { target: { tag: "canvas" } }));
    expect(r).not.toBeNull();
    expect(r!.act).toBe("hop");
    expect(r!.expression).toBe("surprised");
  });

  it("maps plain page click to smile + blink", () => {
    const s = new RuleStrategy({ now });
    const r = s.decide(ev("click"));
    expect(r!.expression).toBe("smile");
    expect(r!.blink).toBe(true);
  });

  it("suppresses repeats inside the cooldown window", () => {
    const s = new RuleStrategy({ now });
    tick(0);
    expect(s.decide(ev("click"))).not.toBeNull();
    tick(1000);
    expect(s.decide(ev("click"))).toBeNull(); // 5s cooldown for page click
    tick(4000); // t=5000, exactly at boundary
    const r = s.decide(ev("click"));
    expect(r).not.toBeNull();
  });

  it("canvas click has its own cooldown track", () => {
    const s = new RuleStrategy({ now });
    expect(s.decide(ev("click", { target: { tag: "canvas" } }))).not.toBeNull();
    tick(500);
    expect(s.decide(ev("click"))).not.toBeNull(); // different track, allowed
  });

  it("hover-enter randomly picks shy or smile", () => {
    const s = new RuleStrategy({ now });
    const got = new Set<string>();
    for (let i = 0; i < 20; i++) {
      t = i * 10_000; // far apart: each hover passes cooldown
      const r = s.decide(ev("hover-enter", { target: { tag: "a" } }));
      got.add(r!.expression!);
    }
    expect(got.size).toBeGreaterThanOrEqual(1);
    for (const e of got) expect(["shy", "smile"]).toContain(e);
  });

  it("scroll gaze direction follows deltaY sign", () => {
    const s = new RuleStrategy({ now });
    tick(0);
    const r = s.decide(ev("scroll", { deltaY: 400 }))!;
    expect(r.params!.eyeBallX).toBeGreaterThan(0);
    tick(2000);
    const r2 = s.decide(ev("scroll", { deltaY: -400 }))!;
    expect(r2.params!.eyeBallX).toBeLessThan(0);
  });

  it("idle picks variants from the candidate set", () => {
    const s = new RuleStrategy({ now });
    const kinds = new Set<string>();
    for (let i = 0; i < 24; i++) {
      t = i * 20_000;
      const r = s.decide(ev("idle", { idleMs: 15000 }));
      if (!r) continue;
      if (r.act) kinds.add("act:" + r.act);
      else if (r.expression) kinds.add("expr:" + r.expression);
      else if (r.params) kinds.add("gaze");
    }
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  });

  it("user override replaces the default for an event type", () => {
    const s = new RuleStrategy({
      now,
      rules: {
        click: [
          {
            reaction: { act: "nod", expression: "smile" },
            cooldownMs: 100,
          },
        ],
      },
    });
    const r = s.decide(ev("click"))!;
    expect(r.act).toBe("nod");
    expect(r.expression).toBe("smile");
  });

  it("null override disables an event type entirely", () => {
    const s = new RuleStrategy({ now, rules: { click: null } });
    expect(s.decide(ev("click"))).toBeNull();
  });

  it("jitter keeps param offsets inside ±(1±2·ratio) band", () => {
    const s = new RuleStrategy({ now });
    for (let i = 0; i < 50; i++) {
      t = i * 2000;
      const r = s.decide(ev("scroll", { deltaY: 100 }))!;
      const v = r.params!.eyeBallX!;
      expect(Math.abs(v)).toBeLessThanOrEqual(0.3 * 1.4 + 1e-9);
      expect(Math.abs(v)).toBeGreaterThanOrEqual(0.3 * 0.6 - 1e-9);
    }
  });
});
