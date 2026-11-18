import { afterEach, describe, expect, it, vi } from 'vitest'
import { startupDeadline, waitForStartupContent } from '../../shared/utils/startup'

afterEach(() => vi.useRealTimers())
describe('startup readiness budgets', () => {
  it('does not impose a minimum duration on ready data', async () => {
    vi.useFakeTimers()
    await expect(startupDeadline(async () => 'ready', 30_000)).resolves.toBe('ready')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('aborts hung essential work and observes its late rejection', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal, reject!: (error: Error) => void
    const result = startupDeadline(current => { signal = current; return new Promise((_, fail) => { reject = fail }) }, 30_000)
    const assertion = expect(result).rejects.toThrow('tardando demasiado')
    await vi.advanceTimersByTimeAsync(30_000); await assertion
    expect(signal.aborted).toBe(true)
    reject(new Error('late failure')); await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('opens after the content budget without cancelling the request', async () => {
    vi.useFakeTimers()
    let complete!: () => void
    const request = new Promise<void>(resolve => { complete = resolve })
    const wait = waitForStartupContent([request])
    await vi.advanceTimersByTimeAsync(5000); await wait
    let finished = false; void request.then(() => { finished = true })
    await Promise.resolve(); expect(finished).toBe(false)
    complete(); await request; expect(finished).toBe(true)
  })
  it('propagates closing rather than treating it as optional failure', async () => {
    const lifetime = new AbortController()
    const wait = waitForStartupContent([new Promise(() => {})], 5000, lifetime.signal)
    const assertion = expect(wait).rejects.toThrow()
    lifetime.abort(); await assertion
  })
})
