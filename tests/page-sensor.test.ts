import { describe, expect, it, vi } from "vite-plus/test";
import { PageSensor } from "../src/core/PageSensor";
import type { PageEvent } from "../src/types";

/** Minimal EventTarget-style fake: records listeners, replays events. */
function makeRoot() {
  const listeners = new Map<string, Set<(e: any) => void>>();
  const timers: { fn: () => void; every: number }[] = [];
  const root = {
    addEventListener: vi.fn((type: string, fn: (e: any) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: (e: any) => void) => {
      listeners.get(type)?.delete(fn);
    }),
    setInterval: vi.fn((fn: () => void, every: number) => {
      timers.push({ fn, every });
      return timers.length;
    }),
    clearInterval: vi.fn((id: number) => {
      timers.splice(id - 1, 1);
    }),
    fire(type: string, event: any) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    listeners,
    timers,
  };
  return root;
}

function element(partial: {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  closest?: string | null;
}) {
  return {
    tagName: partial.tag.toUpperCase(),
    id: partial.id ?? "",
    classList: {
      contains: (c: string) => (partial.classes ?? []).includes(c),
    },
    classListArr: partial.classes ?? [],
    className: (partial.classes ?? []).join(" "),
    textContent: partial.text ?? "",
    closest: (sel: string) =>
      partial.closest === undefined ? null : partial.closest === sel ? ({} as never) : null,
  };
}

describe("PageSensor", () => {
  it("maps clicks to PageEvents with a truncated target summary", () => {
    const root = makeRoot();
    const events: PageEvent[] = [];
    new PageSensor({ root: root as never, onEvent: (e) => events.push(e) });

    root.fire("click", {
      target: element({ tag: "button", id: "buy", classes: ["cta", "big"], text: "x".repeat(200) }),
      clientX: 12,
      clientY: 34,
    });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("click");
    expect(events[0].target!.tag).toBe("button");
    expect(events[0].target!.id).toBe("buy");
    expect(events[0].target!.text).toHaveLength(80);
    expect(events[0].x).toBe(12);
    expect(events[0].y).toBe(34);
  });

  it("emits hover-enter/leave only for interactive elements", () => {
    const root = makeRoot();
    const events: PageEvent[] = [];
    new PageSensor({ root: root as never, onEvent: (e) => events.push(e) });

    root.fire("pointerover", {
      target: element({ tag: "a", closest: "a,button,[data-vtuber-reactive]" }),
    });
    root.fire("pointerover", { target: element({ tag: "div" }) }); // ignored
    root.fire("pointerout", {
      target: element({ tag: "a", closest: "a,button,[data-vtuber-reactive]" }),
    });

    expect(events.map((e) => e.type)).toEqual(["hover-enter", "hover-leave"]);
  });

  it("does not double-fire hover-enter without a leave", () => {
    const root = makeRoot();
    const events: PageEvent[] = [];
    new PageSensor({ root: root as never, onEvent: (e) => events.push(e) });
    root.fire("pointerover", {
      target: element({ tag: "button", closest: "a,button,[data-vtuber-reactive]" }),
    });
    root.fire("pointerover", {
      target: element({ tag: "button", closest: "a,button,[data-vtuber-reactive]" }),
    });
    expect(events.length).toBe(1);
  });

  it("passes wheel deltaY as a scroll event", () => {
    const root = makeRoot();
    const events: PageEvent[] = [];
    new PageSensor({ root: root as never, onEvent: (e) => events.push(e) });
    root.fire("wheel", { deltaY: 240 });
    expect(events[0].type).toBe("scroll");
    expect(events[0].deltaY).toBe(240);
  });

  it("computes pointer speed on pointer-move", () => {
    const root = makeRoot();
    const events: PageEvent[] = [];
    let t = 1000;
    new PageSensor({
      root: root as never,
      onEvent: (e) => events.push(e),
      now: () => t,
    });
    root.fire("pointermove", { clientX: 0, clientY: 0, timeStamp: 1000 });
    expect(events.length).toBe(0); // first sample: no speed yet
    t = 1500; // 500 ms later
    root.fire("pointermove", { clientX: 100, clientY: 0, timeStamp: 1500 });
    expect(events.length).toBe(1);
    expect(events[0].pointerSpeed).toBeCloseTo(200); // 100px / 0.5s
  });

  it("emits idle events while nothing happens, resets on activity", () => {
    const root = makeRoot();
    const events: PageEvent[] = [];
    let t = 0;
    const sensor = new PageSensor({
      root: root as never,
      onEvent: (e) => events.push(e),
      idleAfterMs: 5000,
      now: () => t,
    });
    expect(sensor.intervalMsForTest).toBeGreaterThan(0);
    expect(root.timers.length).toBe(1);
    const idleEvents = () => events.filter((e) => e.type === "idle");

    root.timers[0].fn(); // t=0: not idle
    expect(idleEvents().length).toBe(0);
    t = 6000;
    root.timers[0].fn(); // idle now
    expect(idleEvents().length).toBe(1);
    expect(idleEvents()[0].idleMs).toBe(6000);
    t = 8000;
    root.timers[0].fn(); // still idle: emits again
    expect(idleEvents().length).toBe(2);

    root.fire("click", { target: element({ tag: "div" }), clientX: 0, clientY: 0 }); // activity → lastActivity=8000
    t = 9000;
    root.timers[0].fn(); // reset: not idle
    expect(idleEvents().length).toBe(2);
    t = 14000;
    root.timers[0].fn(); // idle again: 14000 - 8000 ≥ 5000
    const idles = idleEvents();
    expect(idles.length).toBe(3);
    expect(idles[2].idleMs).toBe(6000);
  });

  it("dispose removes listeners and the idle timer", () => {
    const root = makeRoot();
    const events: PageEvent[] = [];
    const sensor = new PageSensor({ root: root as never, onEvent: (e) => events.push(e) });
    const before = [...root.listeners.entries()].map(([k, v]) => [k, v.size] as const);
    sensor.dispose();
    expect([...root.listeners.entries()].map(([k, v]) => [k, v.size] as const)).toEqual(
      before.map(([k]) => [k, 0] as const),
    );
    expect(root.timers.length).toBe(0);
    root.fire("click", { target: element({ tag: "div" }) });
    expect(events.length).toBe(0);
  });

  it("event filters apply", () => {
    const root = makeRoot();
    const events: PageEvent[] = [];
    new PageSensor({
      root: root as never,
      onEvent: (e) => events.push(e),
      events: { scroll: false, pointerMove: false },
    });
    root.fire("wheel", { deltaY: 100 });
    root.fire("pointermove", { clientX: 5, clientY: 5, timeStamp: 0 });
    root.fire("click", { target: element({ tag: "div" }), clientX: 1, clientY: 1 });
    expect(events.map((e) => e.type)).toEqual(["click"]);
  });
});
