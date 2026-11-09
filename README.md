# ai-vtuber-web

**中文** · [English](#english)

给 [LivLiv Player](https://github.com/livliv-dev/player) 加一层「活人感」的轻量库：角色不再是一个静态摆件，而是**会自动动、会根据你在网页上的行为做出反应**的虚拟主播 —— 点击、悬停、滚动、发呆，她都有表现。纯浏览器运行，无需 OBS。

- **双策略**：`rules`（纯前端规则引擎，零网络）/ `agent`（LLM 大脑决定反应，自带 OpenAI-compatible endpoint）/ `auto`（有 agent 配置就用 agent，出错自动回退 rules）
- **零硬依赖**：`@livliv-dev/player` 只是可选 peer，任何满足 `PlayerLike` 接口的对象都能接（含 VRM / PNGTuber 的 `BodyPlayer`）
- **克制的设计**：节流 + 频次预算 + 随机变体 + 参数抖动，不会像上了发条一样乱动
- gzip 后约 **7 KB**（不含 player 本体）

```bash
npm install ai-vtuber-web @livliv-dev/player
```

## Quick Start

```ts
import { Player } from '@livliv-dev/player'
import { LivePresence } from 'ai-vtuber-web'

const canvas = document.querySelector('canvas')!
const player = new Player(canvas)
await player.load('https://cdn.jsdelivr.net/gh/livliv-dev/player@main/characters/d03/')

const presence = new LivePresence(player, {
  mode: 'auto',                                 // 'rules' | 'agent' | 'auto'
  idleAfterMs: 15_000,
  throttle: { minIntervalMs: 1200, maxPerMin: 24 },
  onEvent: (e) => console.log('event', e),
  onReaction: (r) => console.log('reaction', r),
  onSay: (text) => console.log('她说：', text), // TTS 由你接入
  onError: (err) => console.error(err),
})
presence.start()

// 运行时切换策略
presence.setMode('rules')
```

就这样。角色的呼吸、眨眼、视线跟随鼠标由 LivLiv Player 自带的 `idle` / `followPointer` 提供；ai-vtuber-web 在其上叠加**行为层**：

| 你的行为 | 角色默认反应 |
|---|---|
| 点击画布 | 惊讶 + 跳一下（hop） |
| 点击页面其他地方 | 微笑 + 眨眼 |
| 悬停链接/按钮 | 害羞 或 微笑（随机） |
| 滚动页面 | 视线随滚动方向瞟过去 |
| 静置 15 秒 | 自己找事做：瞟向别处 / 歪头 / 轻笑 |

所有规则都可以覆盖（见下文 RuleStrategy）。

## Agent 模式（LLM 大脑）

`agent` 只需要一个**你自带**的 chat 函数（OpenAI-compatible 或任何封装）：

```ts
const presence = new LivePresence(player, {
  mode: 'agent',
  agent: {
    chat: async (messages) => {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_LLM_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          temperature: 0.7,
          max_tokens: 200,
        }),
      })
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`)
      const data = await res.json()
      return data.choices[0]?.message?.content ?? ''
    },
    timeoutMs: 4000,      // 超时回退 rules
    characterName: 'Nana',
  },
})
```

工作方式：

- 库把页面事件（点击了什么、滚动方向、空闲多久、最近 3 条事件）压缩成一段 prompt 发给你的 `chat`；
- 要求 LLM 只回一个 JSON：`{ expression, act, params, say, holdMs }`；
- 库做**白名单校验**：表情 id 必须在 `player.expressions` 里、动作必须是 `nod/shake/tilt/hop/shy`、参数按 LivLiv 的范围 clamp，非法字段直接丢弃；
- 超时 / 网络错误 / 坏 JSON → **本次事件自动回退 rules**，页面绝不报错；
- 同一时刻只有一个 LLM 请求在飞，爆发事件由 rules 兜底，不排队。

API Key 安全提示：浏览器直连意味着 key 暴露在前端。生产环境请走自己的后端代理，或使用限制额度的子 key。demo 里 key 只存 sessionStorage（关标签页即清）。

## 自定义策略

```ts
import type { Strategy } from 'ai-vtuber-web'

const hypno: Strategy = {
  name: 'hypno',
  decide(event) {
    if (event.type === 'click') return { expression: 'angry', act: 'shake' }
    return null
  },
}

presence.useStrategy('hypno', hypno) // 'rules' / 'agent' 是保留名
presence.setMode('hypno')
```

`decide` 返回 `Reaction | null`（或其 Promise），`Reaction` 字段见 [types.ts](src/types.ts)：`expression` / `weight` / `act` / `blink` / `params`（每帧叠加的参数 offset）/ `poke` / `say` / `holdMs` / `decayMs`。

## 覆盖默认规则

```ts
const presence = new LivePresence(player, {
  mode: 'rules',
  rules: {
    // 整体替换 click 规则（数组内随机挑一条，各自有冷却）
    click: [
      { match: (e) => e.target?.tag === 'canvas',
        reaction: { act: 'hop', expression: 'angry' }, cooldownMs: 2000 },
      { reaction: { expression: 'sad' }, cooldownMs: 8000 },
    ],
    scroll: null, // 禁用滚动反应
  },
  canvasSelector: '#my-stage', // 标记哪个是 VTuber 画布
})
```

## 支持的角色类型

任何 `PlayerLike` 都行 —— 即 LivLiv 的三种播放器：

- `Player`（LivLiv `.livliv` 模型 / 文件夹）
- `BodyPlayer` + `VrmBody`（VRM 模型）
- `BodyPlayer` + `PngBody`（PNGTuber 立绘）

PNGTuber 没有表情系统：库检测到 `setExpression` 返回 `false` 时自动降级为等价的 `smile` 参数动画，保证反馈不丢失。

## Demo

```bash
git clone https://github.com/neko233-com/ai-vtuber-web
cd ai-vtuber-web
npm install
npm run dev        # http://localhost:5173
```

Demo 包含：模式切换、agent endpoint 配置面板、角色切换（jsDelivr CDN 直载 LivLiv 官方角色）、本地 `.livliv` 拖入、事件日志。

## 工具链（vite-plus）

| 脚本 | 命令 | 说明 |
|---|---|---|
| `npm run dev` | `vp dev` | demo 开发服务器 |
| `npm run build` | `vp build` | demo 构建 → `dist-demo/` |
| `npm run build:lib` | `vp pack` | 库构建 → `dist/`（ESM + d.ts，tsdown） |
| `npm run test` | `vp test` | Vitest（49 个单测，纯逻辑无 WebGL） |
| `npm run check` | `vp check` | 类型检查 + Oxlint + Oxfmt |

## Roadmap

- [ ] TTS 语音接线（`onSay` 回调已预留，配合 `@livliv-dev/player/voice` 的 `createSpeech`）
- [ ] 情绪状态机（互动频次 → 长期情绪倾向）
- [ ] VRM demo 示例页
- [ ] npm 自动发布（GitHub Actions）

## 发布 npm

```bash
npm login          # 首次
npm run build:lib
npm publish
```

## License

- 本库代码：MIT（见 [LICENSE](LICENSE)）
- 角色（LivLiv featured characters）：版权归 LivLiv 及各自作者，**不适用 MIT**。demo 通过 jsDelivr 直接加载官方仓库资源并按要求署名 "Characters: LivLiv (livliv.ai)"。商用前请阅读 [characters/LICENSE.md](https://github.com/livliv-dev/player/blob/main/characters/LICENSE.md)。

---

<a id="english"></a>
# English

A lightweight **living-presence layer** for [LivLiv Player](https://github.com/livliv-dev/player): your web VTuber stops being a static widget and starts reacting to what the user does — clicks, hovers, scroll, idle time. Pure browser, no OBS.

- **Dual strategy**: `rules` (pure frontend state machine, zero network) / `agent` (an LLM brain decides reactions; bring your own OpenAI-compatible endpoint) / `auto` (agent when configured, graceful fallback to rules on any failure)
- **Zero hard deps**: `@livliv-dev/player` is an optional peer; anything matching the `PlayerLike` interface works, including VRM and PNGTuber via `BodyPlayer`
- **Restrained by design**: throttling, per-minute budget, random variants and param jitter — no wind-up-toy behavior
- ~**7 KB gzipped** (excluding the player itself)

```ts
import { Player } from '@livliv-dev/player'
import { LivePresence } from 'ai-vtuber-web'

const player = new Player(canvas)
await player.load('https://cdn.jsdelivr.net/gh/livliv-dev/player@main/characters/d03/')

const presence = new LivePresence(player, { mode: 'auto', agent: { chat: myChat } })
presence.start()
```

Breathing, blinking and pointer-following come from LivLiv Player's own `idle` / `followPointer`; ai-vtuber-web layers **behavior** on top: canvas clicks → surprised + hop, hovering links → shy, scrolling → gaze follows, 15 s idle → she finds something to do. Every rule is overridable; a custom `Strategy` is ~10 lines (see the Chinese section above, or [src/types.ts](src/types.ts) for the `Reaction` shape).

Agent mode sends the LLM a compact event summary plus the player's real expression whitelist and expects one JSON reaction back; the library validates, clamps and falls back to rules on anything that smells wrong. One request in flight at a time.

```bash
npm install ai-vtuber-web @livliv-dev/player
npm run dev     # demo
npm run test    # 49 unit tests
npm run build:lib
```

License: code MIT; the featured characters belong to LivLiv and their authors (credit "Characters: LivLiv (livliv.ai)", non-commercial per their terms).
