import { LivePresence } from "../src/index";
import { AgentStrategy } from "../src/strategies/AgentStrategy";
import { RuleStrategy } from "../src/strategies/RuleStrategy";
import type { AgentConfig, PageEvent, Reaction } from "../src/types";
import { bindAgentForm, log, openAICompatChat, wirePanel } from "./panel";

const CDN = "https://cdn.jsdelivr.net/gh/livliv-dev/player@main/characters/";

function buildAgent(cfg: AgentConfig, rules?: RuleStrategy): AgentStrategy {
  return new AgentStrategy({
    ...cfg,
    fallback: rules ?? new RuleStrategy(),
    characterName: "demo character",
  });
}

function readAgentConfig(): AgentConfig | undefined {
  const url = document.querySelector<HTMLInputElement>("#agent-url")!.value.trim();
  const key =
    sessionStorage.getItem("aivtuber-agent-key") ??
    document.querySelector<HTMLInputElement>("#agent-key")!.value.trim();
  const model = document.querySelector<HTMLInputElement>("#agent-model")!.value.trim();
  if (!url || !model || !key) return undefined;
  return { chat: openAICompatChat(url, key, model), characterName: "demo character" };
}

async function boot() {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
  const { Player } = await import("@livliv-dev/player");

  const player = new Player(canvas, {
    idle: true,
    followPointer: "page",
  });

  const charSelect = document.querySelector<HTMLSelectElement>("#char-select")!;
  await player.load(CDN + charSelect.value + "/");
  console.info("expressions:", player.expressions.map((e) => e.id).join(", "));

  const presence = new LivePresence(player, {
    mode: "auto", // agent when a config is present, rules otherwise
    agent: readAgentConfig(),
    idleAfterMs: 15_000,
    throttle: { minIntervalMs: 1200, maxPerMin: 24 },
    onEvent: (e: PageEvent) => log("event", describeEvent(e)),
    onReaction: (r: Reaction) => log("react", describeReaction(r)),
    onSay: (s) => log("say", `🗣 ${s}`),
    onError: (err) => log("error", String(err)),
  });
  presence.start();
  log("info", `LivePresence started · mode: ${presence.mode}`);

  wirePanel({ presence, charSelect, cdnBase: CDN });

  // Applying agent settings mid-session rebuilds the agent strategy live:
  bindAgentForm(() => {
    const cfg = readAgentConfig();
    if (!cfg) return;
    presence.useStrategy("agent", buildAgent(cfg));
    presence.setMode("agent");
    log("info", "agent 策略已注入并启用");
  });

  // Local model files (.livliv package or folder dump)
  const fileInput = document.querySelector<HTMLInputElement>("#char-file")!;
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.length) {
      player
        .load(fileInput.files)
        .then(() => log("info", "本地模型已加载"))
        .catch((e) => log("error", `load: ${e.message}`));
    }
  });

  // Manual injection demo (sensor also sees these as real DOM events).
  document.querySelector("#trig-click")?.addEventListener("click", () => {
    presence.react({ type: "click", target: { tag: "canvas", classes: ["vtuber-canvas"] } });
  });
}

function describeEvent(e: PageEvent): string {
  const t = e.target ? ` → ${e.target.tag}${e.target.id ? "#" + e.target.id : ""}` : "";
  const extra =
    e.deltaY !== undefined
      ? ` (Δ${e.deltaY})`
      : e.idleMs !== undefined
        ? ` (${Math.round(e.idleMs / 1000)}s idle)`
        : e.pointerSpeed !== undefined
          ? ` (${Math.round(e.pointerSpeed)}px/s)`
          : "";
  return `${e.type}${t}${extra}`;
}

function describeReaction(r: Reaction): string {
  const parts: string[] = [];
  if (r.expression) parts.push(r.expression);
  if (r.act) parts.push(r.act);
  if (r.say) parts.push(`"${r.say}"`);
  if (r.params) parts.push(Object.keys(r.params).join("+"));
  return parts.join(" · ") || "neutral";
}

boot().catch((err) => {
  console.error(err);
  log("error", `boot failed: ${err.message}`);
});
