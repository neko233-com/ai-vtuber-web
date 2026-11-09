import { describe, expect, it } from 'vitest'
import { createBudget } from '../src/util/throttle'

describe('createBudget', () => {
  it('blocks a second call inside minIntervalMs', () => {
    const b = createBudget({ minIntervalMs: 1200, maxPerMin: 10 })
    expect(b.allow(0)).toBe(true)
    expect(b.allow(500)).toBe(false)
    expect(b.allow(1199)).toBe(false)
    expect(b.allow(1200)).toBe(true)
  })

  it('records only allowed calls in the sliding window', () => {
    const b = createBudget({ minIntervalMs: 0, maxPerMin: 2 })
    expect(b.allow(0)).toBe(true)
    expect(b.allow(1)).toBe(true)
    expect(b.allow(2)).toBe(false) // window full
    expect(b.allow(60001)).toBe(true) // first two pruned (60s window)
    expect(b.allow(60002)).toBe(true)
    expect(b.allow(60003)).toBe(false)
  })

  it('maxPerMin caps bursts even with no min interval', () => {
    const b = createBudget({ minIntervalMs: 0, maxPerMin: 3 })
    expect(b.allow(0)).toBe(true)
    expect(b.allow(1)).toBe(true)
    expect(b.allow(2)).toBe(true)
    expect(b.allow(3)).toBe(false)
    expect(b.allow(59000)).toBe(false) // still inside 60s window
    expect(b.allow(60000)).toBe(true) // first entry (t=0) pruned exactly at 60s
  })
})
