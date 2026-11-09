import { describe, expect, it, vi } from "vite-plus/test";
import { AgentStrategy } from "../src/strategies/AgentStrategy";
import { RuleStrategy } from "../src/strategies/RuleStrategy";
import { PARAM_RANGES } from "../src/types";
import type { ChatMessage, PageEvent } from "../src/types";

let t = 0;
const now = () => t;

const ev = (type: PageEvent["type"], extra: Partial<PageEvent> = {}): PageEvent => ({
  type,
  ...extra,
});

/** Deferred fake chat: resolves when we release it. */
function deferredChat() {
  let resolve!: (v: string) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const fn = vi.fn(() => promise);
  return { fn, resolve, reject, promise };
}

function makeAgent(
  chat: (msgs: ChatMessage[]) => Promise<string>,
  timeoutMs = 4000,
): { agent: AgentStrategy; fallback: RuleStrategy } {
  const fallback = new RuleStrategy({
    now,
    rules: {
      // deterministic fallbacks for assertions
      click: [{ reaction: { expression: "smile" }, cooldownMs: 0 }],
      "hover-enter": [{ reaction: { expression: "shy" }, cooldownMs: 0 }],
    },
  });
  const agent = new AgentStrategy({
    chat,
    timeoutMs,
    fallback,
    expressions: [{ id: "smile" }, { id: "shy" }, { id: "surprised" }],
    now,
  });
  return { agent, fallback };
}

describe("AgentStrategy", () => {
  it("parses a plain JSON reply into a validated reaction", async () => {
    const { fn, resolve } = deferredChat();
    const { agent } = makeAgent(fn);
    const p = agent.decide(ev("click", { target: { tag: "canvas" } }));
    setTimeout(() => resolve(JSON.stringify({ expression: "shy", act: "nod" })), 0);
    const r = await p;
    expect(r).not.toBeNull();
    expect(r!.expression).toBe("shy");
    expect(r!.act).toBe("nod");
    expect(fn).toHaveBeenCalledOnce();
    const msgs = fn.mock.calls[0][0] as ChatMessage[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("JSON");
    expect(msgs[1].content).toContain("click");
  });

  it("parses a fenced ```json reply", async () => {
    const { fn, resolve } = deferredChat();
    const { agent } = makeAgent(fn);
    const p = agent.decide(ev("hover-enter", { target: { tag: "a" } }));
    setTimeout(() => resolve('```json\n{"expression":"smile"}\n```'), 0);
    const r = await p;
    expect(r!.expression).toBe("smile");
  });

  it("falls back to rules on timeout", async () => {
    const { fn } = deferredChat(); // never resolves
    const { agent } = makeAgent(fn, 50);
    const r = await agent.decide(ev("click"));
    expect(r).not.toBeNull(); // rules reaction
    expect(r!.expression).toBe("smile"); // page click default
  });

  it("falls back to rules when chat throws", async () => {
    const chat = vi.fn(async () => {
      throw new Error("boom");
    });
    const { agent } = makeAgent(chat);
    const r = await agent.decide(ev("click"));
    expect(r).not.toBeNull();
    expect(r!.expression).toBe("smile");
  });

  it("drops an unknown expression but keeps the valid act", async () => {
    const { fn, resolve } = deferredChat();
    const { agent } = makeAgent(fn);
    const p = agent.decide(ev("click"));
    setTimeout(() => resolve(JSON.stringify({ expression: "wink", act: "hop" })), 0);
    const r = await p;
    expect(r!.expression).toBeUndefined();
    expect(r!.act).toBe("hop");
  });

  it("clamps out-of-range params", async () => {
    const { fn, resolve } = deferredChat();
    const { agent } = makeAgent(fn);
    const p = agent.decide(ev("click"));
    setTimeout(() => resolve(JSON.stringify({ params: { browLY: 7, eyeBallX: -9 } })), 0);
    const r = await p;
    expect(r!.params!.browLY).toBe(PARAM_RANGES.browLY[1]);
    expect(r!.params!.eyeBallX).toBe(PARAM_RANGES.eyeBallX[0]);
  });

  it("second event while in flight goes straight to rules (no queue)", async () => {
    const { fn } = deferredChat();
    const { agent } = makeAgent(fn);
    const first = agent.decide(ev("click"));
    const second = await agent.decide(ev("hover-enter", { target: { tag: "a" } }));
    expect(second).not.toBeNull();
    expect(second!.expression).toBe("shy"); // rules default
    expect(fn).toHaveBeenCalledOnce();
    await first;
  });

  it("keeps a rolling memory of recent events in the prompt", async () => {
    const { fn, resolve } = deferredChat();
    const { agent } = makeAgent(fn);
    void agent.decide(ev("click")).catch(() => {});
    setTimeout(() => resolve("{}"), 0);
    const first = await agent.decide(ev("click"));
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    const secondP = agent.decide(ev("idle", { idleMs: 15000 }));
    setTimeout(() => resolve(JSON.stringify({ act: "tilt" })), 0);
    await secondP;
    const lastMsgs = fn.mock.calls.at(-1)![0] as ChatMessage[];
    expect(lastMsgs[1].content).toContain("idle");
  });
});
