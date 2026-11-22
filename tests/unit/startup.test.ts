import { afterEach, describe, expect, it, vi } from 'vitest'
import { deadlineSignal, reconnectDelay, startupDeadline, waitForStartupContent } from '../../shared/utils/startup'

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

describe('requests to an unreachable PC', () => {
  it('aborts after the deadline even when a caller signal is present', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const deadline = deadlineSignal(3000, parent.signal)
    await vi.advanceTimersByTimeAsync(2999); expect(deadline.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1); expect(deadline.signal.aborted).toBe(true)
    expect((deadline.signal.reason as DOMException).name).toBe('TimeoutError')
    expect(parent.signal.aborted).toBe(false)
    deadline.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
  it('follows the caller cancellation and releases its timer', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const deadline = deadlineSignal(3000, parent.signal)
    parent.abort(new Error('cancelled'))
    expect(deadline.signal.aborted).toBe(true); expect((deadline.signal.reason as Error).message).toBe('cancelled')
    deadline.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
  it('backs off reconnection attempts up to 30 seconds', () => {
    expect([0, 1, 2, 3, 4, 20].map(reconnectDelay)).toEqual([3000, 6000, 12000, 30000, 30000, 30000])
  })
})
