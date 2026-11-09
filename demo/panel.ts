import type { LivePresence } from "../src/index";

const logEl = () => document.querySelector<HTMLDivElement>("#log")!;

export function log(kind: "event" | "react" | "say" | "error" | "info", text: string): void {
  const el = logEl();
  const line = document.createElement("div");
  line.className = `log-line log-${kind}`;
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  line.textContent = `[${time}] ${text}`;
  el.prepend(line);
  while (el.children.length > 200) el.removeChild(el.lastChild!);
}

interface PanelContext {
  presence: LivePresence;
  charSelect: HTMLSelectElement;
  cdnBase: string;
}

/** Wire mode buttons, character select and agent form. */
export function wirePanel({ presence, charSelect, cdnBase }: PanelContext): void {
  const rulesBtn = document.querySelector<HTMLButtonElement>("#mode-rules")!;
  const agentBtn = document.querySelector<HTMLButtonElement>("#mode-agent")!;
  const agentConfig = document.querySelector<HTMLElement>("#agent-config")!;

  function setActive(mode: "rules" | "agent") {
    rulesBtn.classList.toggle("active", mode === "rules");
    agentBtn.classList.toggle("active", mode === "agent");
    agentConfig.hidden = mode !== "agent";
  }

  rulesBtn.addEventListener("click", () => {
    presence.setMode("rules");
    setActive("rules");
    log("info", "模式 → rules（纯前端规则）");
  });

  agentBtn.addEventListener("click", () => {
    try {
      presence.setMode("agent");
      setActive("agent");
      log("info", "模式 → agent（LLM 大脑）");
    } catch {
      setActive("agent");
      log("info", "先填写 agent 配置（OpenAI-compatible endpoint）");
    }
  });

  charSelect.addEventListener("change", () => {
    const url = cdnBase + charSelect.value + "/";
    location.search = `?model=${encodeURIComponent(url)}`;
  });

  // Support ?model= deep links (matches LivLiv example convention).
  const params = new URLSearchParams(location.search);
  const modelParam = params.get("model");
  if (modelParam) {
    for (const opt of Array.from(charSelect.options)) {
      opt.selected = opt.value === modelParam.replace(/\/$/, "").split("/").pop();
    }
  }

  // Restore remembered agent endpoint (never the key).
  try {
    const saved = localStorage.getItem("aivtuber-agent");
    if (saved) {
      const { url, model } = JSON.parse(saved) as { url: string; model: string };
      document.querySelector<HTMLInputElement>("#agent-url")!.value = url ?? "";
      document.querySelector<HTMLInputElement>("#agent-model")!.value = model ?? "";
    }
  } catch {
    /* ignore corrupt storage */
  }
}

/** Persist agent settings; the chat fn is rebuilt on boot from these. */
export function bindAgentForm(onApplied?: () => void): void {
  document.querySelector<HTMLButtonElement>("#agent-apply")!.addEventListener("click", () => {
    const url = document.querySelector<HTMLInputElement>("#agent-url")!.value.trim();
    const key = document.querySelector<HTMLInputElement>("#agent-key")!.value.trim();
    const model = document.querySelector<HTMLInputElement>("#agent-model")!.value.trim();
    const remember = document.querySelector<HTMLInputElement>("#agent-remember")!.checked;

    if (!url || !model || !key) {
      log("error", "Base URL / API Key / Model 都必填");
      return;
    }
    sessionStorage.setItem("aivtuber-agent-key", key); // tab-scoped, not persisted
    if (remember) {
      localStorage.setItem("aivtuber-agent", JSON.stringify({ url, model }));
    }
    log("info", `agent 配置已保存：${model} @ ${url}`);
    onApplied?.();
  });
}

export function openAICompatChat(baseURL: string, apiKey: string, model: string) {
  return async (messages: Array<{ role: string; content: string }>): Promise<string> => {
    const res = await fetch(baseURL.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 200 }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  };
}
