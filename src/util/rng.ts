/** Pick a random element; undefined for an empty array. */
export function pick<T>(arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Multiplicative jitter: v scaled by (1 - ratio .. 1 + ratio). */
export function jitter(v: number, ratio = 0.2): number {
  return v * (1 - ratio + Math.random() * 2 * ratio)
}
