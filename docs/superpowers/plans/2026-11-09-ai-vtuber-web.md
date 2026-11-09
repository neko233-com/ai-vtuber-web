# ai-vtuber-web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved spec — a living-presence TypeScript library (`ai-vtuber-web`) wrapping LivLiv Player with rules/agent strategies, a Vite demo, full unit tests, then publish to GitHub (`neko233-com/ai-vtuber-web`) with tag `v0.1.0` + release.

**Architecture:** `PageSensor` (DOM → typed events) → `LivePresence` (throttle/budget/mode dispatch) → `Strategy` (`RuleStrategy` | `AgentStrategy` | custom) → `Reactor` (persistent `player.use()` driver + discrete calls, hold→decay easing). Zero hard deps; `@livliv-dev/player` is an optional peer.

**Tech Stack:** TypeScript, vite-plus (`vp dev/build/pack/test/check`), tsdown (lib + d.ts), Vitest (globals), MIT.

**Spec:** `docs/superpowers/specs/2026-11-09-ai-vtuber-web-design.md`
**Executor note:** Deviations allowed where toolchain reality differs (record in final report). Demo VRM loading omitted (needs three.js deps) — PNGTuber + LivLiv model + local `.livliv` covered; VRM stays supported by the lib (`PlayerLike` covers `BodyPlayer`), listed in README.

---

### Task 1: Scaffold & toolchain

**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `tsdown.config.ts`, `vitest.config.ts`, `.gitignore`, `LICENSE`.

- [ ] Write `package.json` (name `ai-vtuber-web`, v0.1.0, exports/types/files, peerDeps `@livliv-dev/player` optional, scripts `dev/build/build:lib/test/check/fmt` → `vp …`), `.gitignore` (`node_modules/`, `dist/`, `dist-demo/`, `*.log`), MIT `LICENSE` (copyright `neko233-com`).
- [ ] `tsconfig.json`: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `skipLibCheck: true`, `include: ["src", "demo", "tests"]` (tests excluded from build via tsdown entry only).
- [ ] `vite.config.ts`: `root: 'demo'`, `build.outDir: '../dist-demo'`, `base: './'`.
- [ ] `tsdown.config.ts`: plain object default export `{ entry: ['src/index.ts'], format: ['esm'], dts: true, outDir: 'dist', clean: true, sourcemap: true }` (no imports → no version-split issues).
- [ ] `vitest.config.ts`: `test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] }`.
- [ ] `npm install` devDeps: `vite-plus`, `vite`, `tsdown`, `typescript`, `@livliv-dev/player`; verify `npx vp --version` prints a version.
- [ ] Commit: `chore: scaffold vite-plus toolchain`.

### Task 2: Types & utils (TDD)

**Files:** Create `src/types.ts`, `src/util/clamp.ts`, `src/util/rng.ts`, `src/util/throttle.ts`; Test `tests/throttle.test.ts`.

- [ ] **types.ts** (full, from spec §5): `PresenceMode`, `PageEvent` (types: `click|hover-enter|hover-leave|scroll|pointer-move|idle`; fields `target?`, `x?`, `y?`, `pointerSpeed?`, `idleMs?`, `deltaY?`, `idleMs?`), `Reaction`, `Strategy`, `PlayerLike` (`setExpression(id, weight?): boolean`, `act(id: string)`, `blink()`, `params: Record<string, number>`, `use(d: {update(f: Frame): void}): () => void`, `poke?(x,y,strength?)`, `expressions: {id: string}[]`), `Frame` (`{ dt: number; time: number; add(o: Record<string, number>): void }`), `PARAM_RANGES` (from LivLiv API.md: angleX/Y/Z ±30, eyeLOpen/eyeROpen/mouthOpen/smile/breath 0..1, eyeBallX/Y/vowel/browLY/browRY ±1, bodyX/Z ±10), `LivePresenceConfig`, callbacks types.
- [ ] **clamp.ts**: `export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))`.
- [ ] **rng.ts**: `pick<T>(arr: T[]): T | undefined`, `jitter(v: number, ratio = 0.2): number` (v * (1 - ratio + Math.random()*2*ratio)).
- [ ] **throttle.ts** `createBudget({ minIntervalMs, maxPerMin })` → `allow(now): boolean`: reject if `now - lastAllowed < minIntervalMs`; prune sliding 60s window; reject if window ≥ maxPerMin; else record and return true.
- [ ] **Failing test first** `tests/throttle.test.ts`: minInterval blocks (t=0 allow, t=500 deny w/ 1200), window prunes after 60s, maxPerMin caps. Run `npx vp test`, expect FAIL (module missing) → implement → PASS.
- [ ] Commit: `feat: core types and throttle budget`.

### Task 3: RuleStrategy (TDD)

**Files:** Create `src/strategies/RuleStrategy.ts`; Test `tests/rule-strategy.test.ts`.

- [ ] Implement `RuleStrategy implements Strategy`:
  - `rules: Record<PageEvent['type'], { reaction: Reaction; cooldownMs: number }[]>` — merge user overrides over `DEFAULT_RULES`; entry value `null` disables that event type.
  - `DEFAULT_RULES`: click (canvas-area event, i.e. event has x/y over canvas → caller passes `target.classes` includes `vtuber-canvas`? Simpler: config option `canvasSelector` matched against target; default fallback generic): canvas click → `{ act:'hop', expression:'surprised', params:{browLY:.4,browRY:.4}, holdMs:700 }` cooldown 3000; page click → `{ expression:'smile', blink:true }` cooldown 5000; hover-enter → random pick `shy`/`smile` cooldown 6000; scroll → `{ params:{ eyeBallX: sign(deltaY)*0.3 } , holdMs:400, decayMs:500 }` cooldown 1200; idle → random pick from [gaze aside `params:{eyeBallX:±.6,eyeBallY:-.2}`, `act:'tilt'`, light `expression:'smile'` weight .5] cooldown 8000.
  - `decide(event)`: per-type `lastFire` map cooldown gate → random candidate → jitter numeric `params` values via `jitter()` → stamp `lastFire` → return reaction or null.
- [ ] Tests (fake injected `now` via `constructor({ now })`): correct reaction category per event; cooldown window returns null; random variant ∈ candidate set; user override replaces; `null` disables; jitter stays within ±2×ratio band (run 50 samples).
- [ ] Run `npx vp test` → PASS. Commit: `feat: RuleStrategy with cooldowns and variants`.

### Task 4: AgentStrategy (TDD)

**Files:** Create `src/strategies/AgentStrategy.ts`; Test `tests/agent-strategy.test.ts`.

- [ ] Implement constructor `{ chat, expressions, timeoutMs = 4000, fallback, recentSize = 3, characterName }`:
  - `decide(event)`: if `inFlight` → return `fallback.decide(event)` immediately (no queue). Else build messages: system prompt (fixed persona: "behavior brain of a web VTuber, output ONLY JSON, schema {expression, act, params, say, holdMs}", whitelists of `expressions` ids, acts `[nod,shake,tilt,hop,shy]`, param keys from `PARAM_RANGES`), user payload = event summary + `idleMs` + last N events + last decision. `AbortController` + `setTimeout` timeout → `chat(messages)` → strip ```` ```json ```` fences → `JSON.parse` → validate: unknown `expression`/`act` dropped, `params` clamped by `PARAM_RANGES`, non-numeric dropped → return Reaction. On ANY error/timeout → `fallback.decide(event)`. Track `recent` ring buffer. `inFlight` reset in `finally`.
- [ ] Tests with fake `chat` (deferred promises): valid JSON → mapped reaction; fenced JSON → parsed; timeout (advance fake timers, abort) → fallback reaction; chat throws → fallback; illegal expression dropped but act kept; busy (second decide while first pending) → immediate fallback.
- [ ] Run `npx vp test` → PASS. Commit: `feat: AgentStrategy with timeout fallback and validation`.

### Task 5: Reactor (TDD)

**Files:** Create `src/core/Reactor.ts`; Test `tests/reactor.test.ts`.

- [ ] Implement `Reactor`:
  - `constructor(player: PlayerLike)`: `this.removeDriver = player.use({ update: (f) => this.tick(f.dt, f.add) })`.
  - `apply(reaction)`: params target replaces current (continuity: current values kept), `phase='hold'`, `holdEnds = time + holdMs`, `decayEnds = holdEnds + decayMs`; expression handling: if provided, `ok = player.setExpression(id, weight)`; on `false` → degrade via `EXPRESSION_FALLBACK` (`smile`/`shy` → `{smile: .8*weight}` merged into params; others dropped); store `restoreAt = decayEnds`, `restoreExpr = true`. `act` → `player.act(id)`; `blink` → `player.blink()`; `poke` → `player.poke?.(...)`.
  - `tick(dt, add)`: hold phase → `add(target)`; decay → linear `target * (1 - p)`; after decayEnds → zero, and if `restoreExpr && now ≥ restoreAt` → `player.setExpression(null)` once.
  - `dispose()`: `removeDriver()`.
  - New `apply` interrupts decay smoothly (target swap, phase reset).
- [ ] Tests with fake player + manual `tick` steps: offset added during hold; linear decay values at 0/50/100%; new apply mid-decay resets; expression restore called once after decay; `setExpression→false` on PNGTuber-like player degrades to `smile` param.
- [ ] Run `npx vp test` → PASS. Commit: `feat: Reactor driver with hold/decay easing`.

### Task 6: PageSensor (TDD)

**Files:** Create `src/core/PageSensor.ts`; Test `tests/page-sensor.test.ts`.

- [ ] Implement constructor `{ root = document, idleAfterMs = 15000, intervalMs = 1000, onEvent, canvasSelector? }`:
  - Listeners (all passive except click): `click` → event `{type:'click', target: summarize(e.target), x,y}`; `pointerover/out` filtered by `target.closest('a,button,[data-vtuber-reactive]')` → hover-enter/leave (dedupe via `hovered` flag); `wheel` → `{type:'scroll', deltaY}` (throttled 300ms); `pointermove` → throttled 250ms, speed = dist/dt vs last sample → `{type:'pointer-move', x,y,pointerSpeed}`.
  - Idle: `setInterval` checks `now - lastActivity ≥ idleAfterMs` → emit `{type:'idle', idleMs}` every `idleAfterMs` while idle; any activity resets `lastActivity` and idle latch.
  - `summarize(el)`: `{tag, id, classes(≤3), text: textContent.trim().slice(0,80)}` guarded for non-elements.
  - `dispose()`: remove listeners + clearInterval.
- [ ] Tests with a fake root (captures handler map) + synthetic event objects: click → PageEvent w/ truncated text; hover enter/leave on `button`; wheel deltaY passthrough; idle emission with injected `now`; dispose removes handlers.
- [ ] Run `npx vp test` → PASS. Commit: `feat: PageSensor DOM event mapping`.

### Task 7: LivePresence + exports (TDD)

**Files:** Create `src/core/LivePresence.ts`, `src/index.ts`; Test `tests/live-presence.test.ts`.

- [ ] `LivePresence`:
  - constructor(player, config): resolve mode (`auto` → agent config present ? `'agent'` : `'rules'`); build `RuleStrategy` (config.rules) and, if agent config, `AgentStrategy` (fallback = rules instance); registry; Reactor; budget from config.throttle (defaults 1200/24); `now = config.now ?? Date.now`.
  - `start()`: sensor with `onEvent: dispatch`; `setMode(name)` (custom registered names allowed; `'agent'` without config → throws + onError); `useStrategy(name, s)`; `react(event)` manual dispatch; `stop()` pause dispatch; `dispose()` full teardown.
  - `dispatch(event)`: strategy = active; `Promise.resolve(strategy.decide(event)).then(r => { if (!r) return; if (!budget.allow(now())) return; reactor.apply(r); if (r.say) onSay?.(r.say); onReaction?.(r, event) }).catch(e => onError?.(e))`.
- [ ] `src/index.ts`: export `LivePresence`, all types, `RuleStrategy`, `AgentStrategy`, `createBudget`, `PARAM_RANGES`.
- [ ] Tests with fake player + fake strategies: rules mode click → reactor applied; budget suppresses burst (3 rapid → 1 applied); agent mode uses agent (spy), agent error → falls back to rules reaction; setMode switches; dispose stops everything; manual `react` works while sensor absent.
- [ ] Run `npx vp test` → PASS. Commit: `feat: LivePresence orchestration and public exports`.

### Task 8: Library build verification

- [ ] `npx vp pack` → verify `dist/index.js` + `dist/index.d.ts` exist and d.ts contains `LivePresence`.
- [ ] `npx vp check` → fix all type/lint errors until clean.
- [ ] Commit: `build: library dist via tsdown`.

### Task 9: Demo app

**Files:** Create `demo/index.html`, `demo/main.ts`, `demo/panel.ts`, `demo/style.css`.

- [ ] `demo/index.html`: two-column layout; `<canvas id="stage">` (LivLiv `Player`), right panel: mode select, agent fields (baseURL/apiKey/model, apiKey stored in memory only — checkbox "remember" → localStorage with warning), character select (`d03` Nana, `k01` Sena, `char06` Aoi, `q02` Mochi via `https://cdn.jsdelivr.net/gh/livliv-dev/player@main/characters/<id>/`), file input `.livliv` + PNGTuber pair input, event log `<div>`, 4 demo triggers (click-me button, hover-me link, scrollable box, do-nothing hint), footer credit "Characters: LivLiv (livliv.ai)".
- [ ] `demo/panel.ts`: wire controls → `presence.setMode` / rebuild presence with agent config; agent chat impl:
  ```ts
  const chat = async (msgs) => {
    const res = await fetch(baseURL.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: msgs, temperature: 0.7, max_tokens: 200 }),
    })
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  }
  ```
- [ ] `demo/main.ts`: create `Player`, load character, `LivePresence` with `onEvent/onReaction/onSay/onError` → log lines (capped 200), fallback `startFaceTracking`? No — out of MVP scope; skip.
- [ ] `demo/style.css`: minimal dark layout, panel scroll.
- [ ] Verify: `npx vp dev` in background → `curl http://localhost:5173/` returns HTML; `npx vp build` → `dist-demo/` produced. Kill dev job.
- [ ] Commit: `feat: demo app with rules/agent panel and character picker`.

### Task 10: README, docs, polish

- [ ] `README.md` bilingual (中文 first, English second): what/why (vs 传统皮套), Quick Start code (spec §5), strategies table, agent config example (OpenAI-compatible fetch), custom strategy example, demo run instructions (`npm install && npm run dev`), character credits + license note, roadmap (TTS `onSay`, 情绪状态机, VRM demo, npm 自动发布), npm publish steps (`npm login` → `npm publish`).
- [ ] `docs/` note: spec + this plan already committed.
- [ ] Final full check: `npx vp test` all PASS, `npx vp check` clean, `npx vp pack` + `npx vp build` clean.
- [ ] Commit: `docs: bilingual README and publish guide`.

### Task 11: Publish (GitHub + tag + release)

- [ ] `gh auth status` → confirm `neko233-com` token.
- [ ] `gh repo create neko233-com/ai-vtuber-web --public --source=. --push` (from repo root; verify remote with `git remote -v`).
- [ ] `git tag -a v0.1.0 -m "v0.1.0: living-presence layer for LivLiv Player"` → `git push origin v0.1.0`.
- [ ] `gh release create v0.1.0 --title "v0.1.0" --notes "<highlights: rules/agent/auto strategies, click/scroll/hover/idle reactions, demo, MIT>"`.
- [ ] npm: `npm whoami` → if E401 (expected per memory), record publish steps in README + final report; do not block.
- [ ] Verify: `gh repo view neko233-com/ai-vtuber-web --web` URL reported; release visible.

---

## Self-Review

- **Spec coverage:** §4 architecture → Tasks 2-7; §5 API → Task 2+7; §6 strategies → Tasks 3-4; §7 Reactor/throttle → Tasks 5+2; §8 demo → Task 9 (VRM demo dropped, noted in header); §9 toolchain → Task 1; §10 tests → Tasks 2-7; §11 errors → 4+7; §12 repo/license → Tasks 1+10+11; §13 milestones map to tasks in order. ✅
- **Placeholder scan:** no TBD/TODO; every code step has concrete content or exact command. ✅
- **Type consistency:** `PageEvent.deltaY` added (scroll direction) — consistent in Task 2 types + Task 3 rule + Task 6 sensor; `PlayerLike.use` returns remover, used by Reactor Task 5 and LivePresence Task 7; `Strategy.decide` sync-or-promise resolved in Task 7 dispatch. ✅
