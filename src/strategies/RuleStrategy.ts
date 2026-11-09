import type { PageEvent, PageEventType, Reaction, RuleEntry, Strategy } from '../types'
import { jitter, pick } from '../util/rng'

export interface RuleStrategyOptions {
  /** Clock for cooldowns; defaults to Date.now. */
  now?: () => number
  /** Merge over DEFAULT_RULES; `null` disables an event type. */
  rules?: Partial<Record<PageEventType, RuleEntry[] | null>>
  /** Selector ('#id', '.class', or tag) marking the VTuber canvas. */
  canvasSelector?: string
}

function isCanvasEvent(canvasSelector: string | undefined, event: PageEvent): boolean {
  const t = event.target
  if (!t) return false
  if (canvasSelector) {
    if (canvasSelector.startsWith('#')) return t.id === canvasSelector.slice(1)
    if (canvasSelector.startsWith('.')) return (t.classes ?? []).includes(canvasSelector.slice(1))
    return t.tag === canvasSelector
  }
  return t.tag === 'canvas' || (t.classes ?? []).includes('vtuber-canvas')
}

/** Scroll reaction: gaze direction follows the wheel sign (jittered later). */
function scrollReaction(event: PageEvent): Reaction {
  const sign = (event.deltaY ?? 0) >= 0 ? 1 : -1
  return {
    params: { eyeBallX: 0.3 * sign, eyeBallY: -0.1 },
    holdMs: 400,
    decayMs: 500,
  }
}

/**
 * Default rule table. Entries with a `match` predicate filter by event;
 * among ready entries one is picked at random. Numeric params get ±20% jitter.
 */
export const DEFAULT_RULES: Record<PageEventType, RuleEntry[] | null> = {
  click: [
    {
      match: (e) => isCanvasEvent(undefined, e),
      reaction: {
        act: 'hop',
        expression: 'surprised',
        params: { browLY: 0.4, browRY: 0.4 },
        holdMs: 700,
        decayMs: 500,
      },
      cooldownMs: 3000,
    },
    {
      match: (e) => !isCanvasEvent(undefined, e),
      reaction: { expression: 'smile', blink: true, holdMs: 500, decayMs: 400 },
      cooldownMs: 5000,
    },
  ],
  'hover-enter': [
    { reaction: { expression: 'shy', holdMs: 800, decayMs: 600 }, cooldownMs: 6000 },
    { reaction: { expression: 'smile', holdMs: 700, decayMs: 500 }, cooldownMs: 6000 },
  ],
  'hover-leave': [{ reaction: { blink: true }, cooldownMs: 3000 }],
  scroll: [{ reaction: scrollReaction, cooldownMs: 1200 }],
  'pointer-move': null,
  idle: [
    {
      reaction: { params: { eyeBallX: 0.6, eyeBallY: -0.2 }, holdMs: 1200, decayMs: 900 },
      cooldownMs: 8000,
    },
    {
      reaction: { params: { eyeBallX: -0.6, eyeBallY: -0.2 }, holdMs: 1200, decayMs: 900 },
      cooldownMs: 8000,
    },
    { reaction: { act: 'tilt' }, cooldownMs: 8000 },
    { reaction: { expression: 'smile', weight: 0.5, holdMs: 900, decayMs: 700 }, cooldownMs: 8000 },
  ],
}

export class RuleStrategy implements Strategy {
  name = 'rules'
  private rules: Record<PageEventType, RuleEntry[] | null>
  private lastFire = new Map<string, number>()
  private now: () => number
  private canvasSelector?: string

  constructor(opts: RuleStrategyOptions = {}) {
    this.now = opts.now ?? Date.now
    this.canvasSelector = opts.canvasSelector
    this.rules = { ...DEFAULT_RULES }
    if (opts.rules) {
      for (const key of Object.keys(opts.rules) as PageEventType[]) {
        this.rules[key] = opts.rules[key] === null ? null : (opts.rules[key] as RuleEntry[])
      }
    }
  }

  decide(event: PageEvent): Reaction | null {
    const entries = this.rules[event.type]
    if (!entries || entries.length === 0) return null

    const t = this.now()
    const ready = entries
      .map((entry, idx) => ({ entry, key: `${event.type}:${idx}` }))
      .filter(({ entry, key }) => {
        if (entry.match && !entry.match(event)) return false
        const last = this.lastFire.get(key) ?? -Infinity
        return t - last >= (entry.cooldownMs ?? 3000)
      })
    if (ready.length === 0) return null

    const chosen = pick(ready)!
    this.lastFire.set(chosen.key, t)

    const base =
      typeof chosen.entry.reaction === 'function'
        ? chosen.entry.reaction(event)
        : chosen.entry.reaction
    return this.randomize(base)
  }

  /** Clone the reaction and jitter its numeric params ±20%. */
  private randomize(base: Reaction): Reaction {
    const r: Reaction = { ...base }
    if (base.params) {
      const params: Record<string, number> = {}
      for (const [k, v] of Object.entries(base.params)) {
        params[k] = typeof v === 'number' ? jitter(v) : v
      }
      r.params = params
    }
    return r
  }
}
