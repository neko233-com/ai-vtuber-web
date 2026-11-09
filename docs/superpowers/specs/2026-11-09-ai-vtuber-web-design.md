# ai-vtuber-web 设计文档

日期：2026-11-09 · 状态：待评审 · 作者：neko233-com（AI 协助起草）

## 1. 目标

做一个增强网站「活人感」的 TypeScript 库：把 LivLiv Player 的角色从「静态摆件」变成「会自动动、会对用户在网页上的行为做出反馈的活的角色」，并附带一个可运行的 demo，发布为公开 GitHub 仓库（`neko233-com/ai-vtuber-web`）与 npm 包（`ai-vtuber-web`，若重名则回退 `@neko233/ai-vtuber-web`）。

核心卖点（相对传统皮套）：

1. **自动动**：空闲时角色自己呼吸、眨眼、瞟人、换表情。
2. **点击/交互反馈**：根据网页点击、滚动、悬停等事件做出匹配的表现（惊讶、害羞、点头……）。
3. **多策略**：`rules`（纯前端规则状态机，零网络）/ `agent`（LLM 大脑决定反应，用户自带 endpoint）/ `auto`（有 agent 配置则 agent，失败自动回退 rules），且支持注册自定义策略。

## 2. 背景：LivLiv Player 已有能力（实测其 API）

来自 [livliv-dev/player](https://github.com/livliv-dev/player) 的 [API.md](https://raw.githubusercontent.com/livliv-dev/player/main/API.md)：

- `idle: true`（默认）自带呼吸/眨眼/摇摆/四处看/偶尔小动作 → **我们不重复实现**。
- `followPointer: 'page'`（默认）自带视线跟随鼠标（眼睛先动、头最多转 ~13°、靠近时挑眉）→ **不重复实现**。
- `setExpression(id, weight)`（标准 id：`smile/shy/angry/sad/surprised/...`，见 `player.expressions`）、`act('nod'|'shake'|'tilt'|'hop'|'shy')`、`blink()`、`poke(x,y)`、`lookAt(x,y)`。
- `params`（`angleX/Y/Z`、`browLY/RY`、`eyeBallX/Y`、`mouthOpen`、`smile`、`bodyX/Z`、`breath` 等）每帧从我们设的值起步再叠加 idle 与 driver；**`player.use(driver)` 可每帧加 offset，叠加在 idle 之上** —— 这是我们注入参数反应的正规通道。
- `BodyPlayer`（VRM / PNGTuber）共用同一套 API（`setExpression`/`act`/`use`/`blink`），因此本库天然支持 VRM 与 PNGTuber。
- 角色（21 个精选角色）**不在 npm 包里**，license 要求署名；demo 通过 jsDelivr CDN 直接加载 GitHub 仓库里的 `characters/<id>/`（jsDelivr 带 `Access-Control-Allow-Origin: *`，满足跨域纹理要求），页面上展示署名 "Characters: LivLiv (livliv.ai)"。

## 3. 范围

**MVP 内**：

- `LivePresence` 编排器：包装已有 `Player`/`BodyPlayer` 实例。
- `PageSensor`：把 DOM 事件转成类型化 `PageEvent`（click / hover-enter / hover-leave / scroll / pointer-move / idle）。
- 策略接口 + `RuleStrategy`（默认规则表，带冷却与随机化）+ `AgentStrategy`（LLM，用户自带 chat 实现，超时/出错回退 rules）。
- `Reactor`：通过常驻 driver + 离散调用应用 `Reaction`，带 hold/decay 缓动回落。
- 节流与频次预算（防刷屏）。
- demo（Vite 应用）：角色切换、模式切换、agent 参数面板、事件日志、可点击的演示按钮、拖入自定义模型。
- 单元测试（纯逻辑，mock player，不依赖 WebGL）。
- 公开 GitHub 仓库 + README（中英双语）+ MIT LICENSE（仅本库代码）。

**MVP 外（README 里列为 roadmap）**：TTS 说话（仅预留 `onSay` 回调钩子）、情绪状态机、视线跟随增强、语音输入、CI/CD、npm 自动发布。

## 4. 架构

```
DOM 事件 ─▶ PageSensor ─▶ PageEvent
                              │
                    ┌─────────▼─────────┐
                    │  LivePresence     │  mode: rules | agent | auto
                    │  (节流/预算/分发) │  自定义策略注册表
                    └─────────┬─────────┘
                    Strategy.decide(event) → Reaction | null
                    ┌─────────┴─────────┐
             RuleStrategy          AgentStrategy ──(超时/错误)──▶ 回退 Rule
                    └─────────┬─────────┘
                              ▼
                          Reactor ─▶ player.use(driver)  ← 参数 offset 叠加
                                   ─▶ setExpression / act / blink / poke
```

- **单向数据流**，各模块只通过明确接口通信，可独立测试。
- `PageSensor` 与 `Reactor` 是唯一的 DOM / Player 触点；Strategy 是纯函数式（event 进、reaction 出），完全无 DOM。

## 5. 公共 API

```ts
import { LivePresence } from "ai-vtuber-web";
import { Player } from "@livliv-dev/player";

const player = new Player(canvas);
await player.load("https://cdn.jsdelivr.net/gh/livliv-dev/player@main/characters/d03/");

const presence = new LivePresence(player, {
  mode: "auto", // 'rules' | 'agent' | 'auto'，默认 'auto'
  agent: { chat: myOpenAICompatChat }, // 用户自带；auto 模式无此项则自动 rules
  events: { click: true, hover: true, scroll: true, pointerMove: true, idle: true },
  throttle: { minIntervalMs: 1200, maxPerMin: 24 },
  idleAfterMs: 15000,
  onEvent,
  onReaction,
  onSay,
  onError, // 可选回调
});
presence.start();
// presence.setMode('rules')  运行时切换
// presence.react({ type: 'click' })  手动注入事件（测试/自定义）
// presence.dispose()
```

类型定义（导出）：

```ts
type PresenceMode = "rules" | "agent" | "auto";

interface PageEvent {
  type: "click" | "hover-enter" | "hover-leave" | "scroll" | "pointer-move" | "idle";
  target?: { tag: string; id?: string; classes?: string[]; text?: string }; // text 截断到 80 字符
  x?: number;
  y?: number;
  pointerSpeed?: number; // px/s
  idleMs?: number;
}

interface Reaction {
  expression?: string | null; // null = 回到中性
  weight?: number; // 0..1，默认 1
  act?: string; // 'nod' | 'shake' | 'tilt' | 'hop' | 'shy'
  blink?: boolean;
  params?: Record<string, number>; // 每帧叠加的 offset，如 { browLY: 0.4 }
  poke?: { x: number; y: number; strength?: number };
  say?: string; // 只透传给 onSay 回调（本库不做 TTS）
  holdMs?: number; // 保持时长，默认 900
  decayMs?: number; // 回落时长，默认 600
}

interface Strategy {
  name: string;
  decide(event: PageEvent): Reaction | null | Promise<Reaction | null>;
  init?(ctx: { player: PlayerLike }): void | Promise<void>;
  dispose?(): void;
}
```

- `PlayerLike` 是结构化最小类型（`setExpression` / `act` / `params` / `use` / `blink` / 可选 `poke`、`lookAt`），不 import LivLiv 的类 → 零硬依赖，`@livliv-dev/player` 只是 peerDependency（demo 里安装）。
- `setExpression` 返回 `false`（模型没有该表情，如 PNGTuber）时，Reactor 降级为等价 params 反应（如 `smile` 参数抬升），保证 PNGTuber 也有反馈。

## 6. 策略

### 6.1 RuleStrategy（默认规则表，全部可覆盖）

| 事件                                                   | 默认反应                                                  | 冷却 |
| ------------------------------------------------------ | --------------------------------------------------------- | ---- |
| click（画布上）                                        | `act('hop')` + `expression:'surprised'` + 微挑眉 offset   | 3s   |
| click（页面其他）                                      | `expression:'smile'` + `blink`                            | 5s   |
| hover-enter（`a`、`button`、`[data-vtuber-reactive]`） | `expression:'shy'` 或 `'smile'`（随机）                   | 6s   |
| scroll                                                 | gaze/头微偏（`eyeBallX`/`angleY` offset，方向随滚动方向） | 1.2s |
| idle（每 `idleAfterMs` 无活动）                        | 随机小动作：瞟向随机方向 / `act('tilt')` / 换随机轻度表情 | 8s   |

- **防机械感**：每次同类反应 70% 概率从候选里随机选一（每个默认反应带 2-3 个变体）；参数 offset 幅度 ±20% 随机。
- 规则表支持用户以 `rules: { click: [Reaction...] , ... }` 整体或单项覆盖；`null` 表示禁用该类事件。

### 6.2 AgentStrategy（LLM 大脑）

- **触发**：通过节流后的 `PageEvent`。
- **Prompt 契约**：system prompt 固定声明「你是网页虚拟角色的行为大脑，只输出 JSON」；user 内容包含：
  - 事件摘要（type、target 文本截断、指针速度、空闲时长）
  - 可用能力清单：`player.expressions` 的实际 id 列表 + 动作列表（nod/shake/tilt/hop/shy）
  - 最近 3 条事件与最近 1 次自己的决定（连续性，不用完整对话史）
- **输出契约**：JSON 对象（`Reaction` 子集：`expression`/`act`/`params`/`say`/`holdMs`）；容忍 ```json 代码围栏；解析失败视为错误。
- **健壮性**：`timeoutMs`（默认 4000）超时或任何错误 → 本次事件回退 RuleStrategy，`onError` 通知，绝不抛出到页面。串行化：上一个 agent 请求未完成时新事件直接走 rules，不排队。
- **安全**：对 LLM 返回的 `expression`/`act` 做白名单校验（必须在 `player.expressions` / 已知动作列表内），非法字段丢弃；`params` 数值 clamp 到 LivLiv 参数范围。

### 6.3 自定义策略

`presence.useStrategy(name, strategy)` 注册后可用 `setMode(name)` 启用；`'rules'`/`'agent'` 为保留名。

## 7. Reactor 细节

- 常驻一个 `player.use(driver)`：每帧把「当前活跃 offset 表」加到 params；offset 在 `holdMs` 内保持、`decayMs` 内线性回落到 0（每帧由 driver 用 `dt` 计算，无定时器堆积）。
- 离散调用：`setExpression(id, weight)`（记录以便 hold 后恢复前一个表情或 `null`）、`act()`、`blink()`、`poke()`。
- 新 Reaction 到来时打断上一个的 decay（平滑过渡，不硬切）。
- 节流：全局 `minIntervalMs` + 滑动窗口 `maxPerMin`；被节流的事件直接丢弃（不排队，避免爆发式补偿）。

## 8. Demo（`demo/`，Vite 应用）

- 布局：左侧画布区（角色 + LivLiv 默认视线跟随开启），右侧控制面板。
- 控制：模式切换（rules / agent / 自定义）、agent 配置（baseURL、apiKey、model —— **apiKey 只存内存，勾选「记住」才写 localStorage 并明示风险**）、事件日志（onEvent/onReaction 打点）、4 个演示按钮（点我、悬停我、滚动区、什么都不做等触发场景）。
- 角色源：内置 4-5 个精选角色 id（jsDelivr CDN 加载）+ 拖拽/选择本地 `.livliv` 文件 / VRM / PNGTuber 图对。
- 底部署名行："Characters: LivLiv (livliv.ai)"（license 要求）。
- demo 使用 `demo/` 独立入口，库从 `../src` 以源码方式引入（monorepo 单包、双入口构建）。

## 9. 仓库布局与工具链（vite-plus）

```
ai-vtuber-web/
  src/                  # 库源码
    index.ts            # 公共导出
    core/               # LivePresence.ts, PageSensor.ts, Reactor.ts
    strategies/         # Strategy.ts, RuleStrategy.ts, AgentStrategy.ts
    util/               # throttle.ts, clamp.ts, pick.ts
  demo/                 # Vite demo 应用（index.html, main.ts, panel.ts, style.css）
  docs/superpowers/specs/   # 本文档与实现计划
  package.json          # name: ai-vtuber-web, type: module
  tsdown.config.ts      # 库构建（vp pack）：ESM + d.ts
  vite.config.ts        # demo 构建（vp build）
  vitest.config.ts      # vp test
```

工具链用 **vite-plus**（本地 `vite-plus` devDependency + `vp` CLI）：

| 脚本        | 命令       | 说明                                  |
| ----------- | ---------- | ------------------------------------- |
| `dev`       | `vp dev`   | demo 开发服务器                       |
| `build`     | `vp build` | demo 构建到 `dist-demo/`              |
| `build:lib` | `vp pack`  | tsdown 库构建 → `dist/`（ESM + d.ts） |
| `test`      | `vp test`  | Vitest 单测                           |
| `check`     | `vp check` | 类型 + Oxlint                         |
| `fmt`       | `vp fmt`   | Oxfmt                                 |

package.json 关键字段：`exports`（`.` → dist/index.js + types）、`files: ["dist"]`、`peerDependencies: { "@livliv-dev/player": "*" }`、`engines.node >= 20`。

## 10. 测试计划

纯逻辑单测（node 环境，mock PlayerLike 为内存对象）：

1. RuleStrategy：各事件 → 正确反应类别；冷却期内返回 null；随机变体落在候选集内；用户覆盖生效。
2. AgentStrategy：合法 JSON / 带围栏 JSON / 超时 / 报错 / 非法表情名 —— 分别得到 正常反应 / 正常反应 / rules 回退 / rules 回退 / 字段丢弃。
3. Reactor：offset 叠加、hold→decay 曲线（用虚拟时间步进 driver）、新反应打断、表情恢复链。
4. 节流：minInterval、maxPerMin 滑窗。
5. PageSensor：用 jsdom 或手写最小 EventTarget stub，验证事件映射与 target 摘要截断。

不测：真实 WebGL 渲染、真实 LLM（由 demo 手动验收）。

## 11. 错误处理

- 库内所有异步（agent 请求、策略 init）都有兜底：失败 → 通知 `onError` → 降级，不让页面出现未捕获 rejection。
- player 未加载模型时：`PageSensor` 照常运行，Reactor 调用会被 LivLiv 内部安全忽略/返回 false，库不崩。
- `dispose()` 后所有监听与 driver 移除；`LivePresence.stop()` 暂停策略分发但保留监听注册结构。

## 12. 仓库与发布

- GitHub 公开仓库 `neko233-com/ai-vtuber-web`，git 身份 `neko233-com <neko233-com@users.noreply.github.com>`。
- LICENSE：MIT（仅本库代码；README 声明角色资源版权归 LivLiv 及其各自作者）。
- README：中英双语，含 Quick Start（复用第 5 节代码）、demo 截图、agent 配置示例（OpenAI-compatible fetch 一段代码）、roadmap。
- npm 发布：`pnpm publish`（首次需 `npm login`，记忆显示当前未登录 —— 发布步骤写进 README，不阻塞本仓库建设）。

## 13. 里程碑

1. 脚手架 + 类型 + PageSensor（含单测）
2. RuleStrategy + Reactor + 节流（含单测）
3. AgentStrategy + 回退（含单测）
4. Demo 可跑（CDN 角色 + 面板 + 日志）
5. README/LICENSE/git 仓库初提交/公开推送
