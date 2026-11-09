import { describe, expect, it, vi } from 'vitest'
import { LivePresence } from '../src/core/LivePresence'
import { Reactor } from '../src/core/Reactor'
import type { PageEvent, PlayerLike, Reaction, Strategy } from '../src/types'

let t = 0
const now = () => t

function makePlayer(): PlayerLike {
  return {
    params: {},
    expressions: [{ id: 'smile' }, { id: 'shy' }, { id: 'surprised' }],
    setExpression: vi.fn(() => true),
    act: vi.fn(),
    blink: vi.fn(),
    use: vi.fn(() => () => {}),
    poke: vi.fn(),
  }
}

const ev = (type: PageEvent['type'], extra: Partial<PageEvent> = {}): PageEvent => ({
  type,
  ...extra,
})

/** Minimal fake sensor: manual event injection. */
class FakeSensor {
  onEvent?: (e: PageEvent) => void
  disposed = false
  constructor(private hook: (s: FakeSensor) => void) {
    hook(this)
  }
  emit(e: PageEvent) {
    this.onEvent?.(e)
  }
  dispose() {
    this.disposed = true
  }
}

vi.mock('../src/core/PageSensor', () => {
  return {
    PageSensor: class {
      constructor(opts: any) {
        opts.onEvent && (globalThis.__lastSensorHook = opts.onEvent)
      }
      dispose() {}
    },
  }
})

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
}

describe('LivePresence', () => {
  it('auto mode picks agent when configured, rules otherwise', () => {
    const player = makePlayer()
    const p1 = new LivePresence(player, { mode: 'auto', now })
    expect(p1.mode).toBe('rules')
    const p2 = new LivePresence(player, {
      mode: 'auto',
      agent: { chat: async () => '{}' },
      now,
    })
    expect(p2.mode).toBe('agent')
  })

  it('dispatches a rules reaction for a click', async () => {
    const player = makePlayer()
    const presence = new LivePresence(player, { mode: 'rules', now })
    presence.start()
    presence.react(ev('click', { target: { tag: 'canvas' } }))
    await flush()
    expect(player.act).toHaveBeenCalledWith('hop')
  })

  it('budget suppresses bursts (3 rapid clicks → 1 reaction)', async () => {
    const player = makePlayer()
    const presence = new LivePresence(player, {
      mode: 'rules',
      throttle: { minIntervalMs: 10_000, maxPerMin: 30 },
      now,
    })
    presence.start()
    presence.react(ev('click'))
    presence.react(ev('click'))
    presence.react(ev('click'))
    await flush()
    expect(player.setExpression).toHaveBeenCalledTimes(1)
  })

  it('agent mode consults the agent and surfaces say via onSay', async () => {
    const player = makePlayer()
    const said: string[] = []
    const presence = new LivePresence(player, {
      mode: 'agent',
      agent: { chat: async () => JSON.stringify({ say: 'hello!', expression: 'smile' }) },
      onSay: (s) => said.push(s),
      now,
    })
    presence.start()
    presence.react(ev('click'))
    await flush()
    await flush()
    expect(said).toEqual(['hello!'])
    expect(player.setExpression).toHaveBeenCalledWith('smile', 1)
  })

  it('agent error falls back to rules', async () => {
    const player = makePlayer()
    const errors: unknown[] = []
    const presence = new LivePresence(player, {
      mode: 'agent',
      agent: {
        chat: async () => {
          throw new Error('network')
        },
      },
      onError: (e) => errors.push(e),
      now,
    })
    presence.start()
    presence.react(ev('click', { target: { tag: 'canvas' } }))
    await flush()
    await flush()
    // rules fallback for a canvas click: hop
    expect(player.act).toHaveBeenCalledWith('hop')
  })

  it('setMode switches strategy at runtime', async () => {
    const player = makePlayer()
    const agentChat = vi.fn(async () => JSON.stringify({ act: 'nod' }))
    const presence = new LivePresence(player, {
      mode: 'rules',
      agent: { chat: agentChat },
      now,
    })
    presence.start()
    presence.react(ev('click'))
    await flush()
    expect(agentChat).not.toHaveBeenCalled()

    presence.setMode('agent')
    presence.react(ev('hover-enter', { target: { tag: 'a' } }))
    await flush()
    await flush()
    expect(agentChat).toHaveBeenCalledOnce()
  })

  it('setMode agent without agent config throws and notifies onError', () => {
    const player = makePlayer()
    const errors: unknown[] = []
    const presence = new LivePresence(player, { mode: 'rules', onError: (e) => errors.push(e), now })
    expect(() => presence.setMode('agent')).toThrowError(/agent/i)
    expect(errors.length).toBe(1)
  })

  it('stop pauses dispatch, start resumes', async () => {
    const player = makePlayer()
    const presence = new LivePresence(player, { mode: 'rules', now })
    presence.start()
    presence.stop()
    presence.react(ev('click'))
    await flush()
    expect(player.act).not.toHaveBeenCalled()
    presence.start()
    presence.react(ev('click'))
    await flush()
    expect(player.blink).toHaveBeenCalled() // page-click rule = smile + blink
  })

  it('custom strategy can be registered and selected', async () => {
    const player = makePlayer()
    const spy: Reaction = { act: 'shake' }
    const custom: Strategy = {
      name: 'party',
      decide: vi.fn(() => spy),
    }
    const presence = new LivePresence(player, { mode: 'rules', now })
    presence.useStrategy('party', custom)
    presence.setMode('party')
    presence.start()
    presence.react(ev('click'))
    await flush()
    expect(custom.decide).toHaveBeenCalledOnce()
    expect(player.act).toHaveBeenCalledWith('shake')
  })

  it('dispose stops the sensor and reactor', async () => {
    const player = makePlayer()
    const presence = new LivePresence(player, { mode: 'rules', now })
    presence.start()
    const reactor = (presence as unknown as { reactor: Reactor }).reactor
    const removeSpy = vi.fn()
    ;(presence as unknown as { reactor: Reactor }).reactor = { ...reactor, dispose: removeSpy } as Reactor
    // simpler: rely on sensor dispose + stop dispatch
    const sensorDispose = vi.spyOn(
      (presence as unknown as { sensor: { dispose(): void } }).sensor,
      'dispose',
    )
    presence.dispose()
    expect(sensorDispose).toHaveBeenCalled()
    presence.react(ev('click'))
    await flush()
    expect(player.act).not.toHaveBeenCalled()
  })

  it('fires onEvent hook for every event', async () => {
    const player = makePlayer()
    const seen: PageEvent[] = []
    const presence = new LivePresence(player, { mode: 'rules', onEvent: (e) => seen.push(e), now })
    presence.start()
    presence.react(ev('scroll', { deltaY: 120 }))
    presence.react(ev('scroll', { deltaY: -120 }))
    await flush()
    expect(seen.length).toBe(2)
  })
})
