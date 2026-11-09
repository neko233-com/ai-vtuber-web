import { PageSensor } from './PageSensor'
import { Reactor } from './Reactor'
import { AgentStrategy } from '../strategies/AgentStrategy'
import { RuleStrategy } from '../strategies/RuleStrategy'
import { createBudget } from '../util/throttle'
import type {
  LivePresenceConfig,
  PageEvent,
  PlayerLike,
  PresenceMode,
  Reaction,
  Strategy,
} from '../types'

const RESERVED_STRATEGIES = new Set(['rules', 'agent'])

/**
 * Orchestrates the living-presence layer: owns the page sensor, the active
 * strategy (rules / agent / custom), the reaction budget and the reactor.
 *
 * ```ts
 * const presence = new LivePresence(player, { mode: 'auto', agent: { chat } })
 * presence.start()
 * ```
 */
export class LivePresence {
  /** Current strategy name ('rules' | 'agent' | custom). */
  mode: PresenceMode

  private player: PlayerLike
  private config: LivePresenceConfig
  private reactor: Reactor
  private sensor: PageSensor | null = null
  private budget: { allow(now: number): boolean }
  private now: () => number
  private strategies = new Map<string, Strategy>()
  private rulesStrategy: RuleStrategy
  private agentStrategy: AgentStrategy | null = null
  private running = false

  constructor(player: PlayerLike, config: LivePresenceConfig = {}) {
    this.player = player
    this.config = config
    this.now = config.now ?? Date.now
    this.rulesStrategy = new RuleStrategy({
      now: this.now,
      rules: config.rules,
      canvasSelector: config.canvasSelector,
    })
    if (config.agent) {
      this.agentStrategy = new AgentStrategy({
        ...config.agent,
        fallback: this.rulesStrategy,
        player,
      })
    }

    this.reactor = new Reactor(player)
    this.budget = createDefaultBudget(config.throttle)

    this.strategies.set('rules', this.rulesStrategy)
    if (this.agentStrategy) this.strategies.set('agent', this.agentStrategy)

    const requested = config.mode ?? 'auto'
    this.mode =
      requested === 'auto' ? (this.agentStrategy ? 'agent' : 'rules') : requested
  }

  /** Begin listening to page events. Safe to call twice. */
  start(): void {
    if (this.running) return
    this.running = true
    this.sensor = new PageSensor({
      idleAfterMs: this.config.idleAfterMs,
      events: this.config.events,
      now: this.now,
      onEvent: (e) => this.dispatch(e),
    })
  }

  /** Pause dispatching (sensor keeps its registrations). */
  stop(): void {
    this.running = false
  }

  /** Full teardown: sensor, reactor driver, strategies. */
  dispose(): void {
    this.running = false
    this.sensor?.dispose()
    this.sensor = null
    this.reactor.dispose()
    for (const s of this.strategies.values()) s.dispose?.()
    this.strategies.clear()
  }

  /**
   * Switch the active strategy at runtime. 'agent' without an agent config
   * throws (and notifies onError).
   */
  setMode(mode: PresenceMode): void {
    if (mode === 'agent' && !this.agentStrategy) {
      const err = new Error(
        'LivePresence: agent mode requires an `agent: { chat }` config.',
      )
      this.config.onError?.(err)
      throw err
    }
    if (!this.strategies.has(mode)) {
      const err = new Error(`LivePresence: unknown strategy "${mode}".`)
      this.config.onError?.(err)
      throw err
    }
    this.mode = mode
  }

  /** Register a custom strategy; select it later via setMode(name). */
  useStrategy(name: string, strategy: Strategy): void {
    if (RESERVED_STRATEGIES.has(name)) {
      throw new Error(`LivePresence: "${name}" is a reserved strategy name.`)
    }
    this.strategies.set(name, strategy)
    void strategy.init?.({ player: this.player })
  }

  /** Manually inject an event (custom widgets, tests). */
  react(event: PageEvent): void {
    this.dispatch(event)
  }

  /** The loaded player expressions, handy for agent prompt building. */
  get expressions(): { id: string }[] {
    return this.player.expressions ?? []
  }

  private dispatch(event: PageEvent): void {
    if (!this.running) return
    this.config.onEvent?.(event)

    const strategy = this.strategies.get(this.mode)
    if (!strategy) return

    Promise.resolve(strategy.decide(event))
      .then((reaction: Reaction | null) => {
        if (!reaction) return
        if (!this.budget.allow(this.now())) return
        this.applyReaction(reaction)
      })
      .catch((err) => this.config.onError?.(err))
  }

  private applyReaction(reaction: Reaction): void {
    this.reactor.apply(reaction)
    if (reaction.say) this.config.onSay?.(reaction.say)
    this.config.onReaction?.(reaction, {} as PageEvent)
  }
}

function createDefaultBudget(throttle?: {
  minIntervalMs?: number
  maxPerMin?: number
}): { allow(now: number): boolean } {
  return createBudget({
    minIntervalMs: throttle?.minIntervalMs ?? 1200,
    maxPerMin: throttle?.maxPerMin ?? 24,
  })
}
