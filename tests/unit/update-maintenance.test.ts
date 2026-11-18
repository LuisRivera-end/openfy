import { afterEach, expect, it, vi } from 'vitest'
import { countOperation, reportClient, updateReadiness } from '../../server/utils/update-maintenance'

const owner = 'desktop', phone = 'phone'
afterEach(() => { reportClient(phone, false, undefined, true); vi.useRealTimers() })

it('requires a fresh acknowledgement before disconnecting a client and rejects active or stale devices', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const { updateChallenge } = await import('../../server/utils/update-maintenance')
  reportClient(phone, true, false)
  expect(updateReadiness(owner, true).ready).toBe(false)
  reportClient(phone, false, true)
  expect(updateReadiness(owner, true).ready).toBe(false)
  const challenge = updateChallenge()
  expect(challenge).toBeTruthy()
  reportClient(phone, false, true, false, challenge)
  expect(updateReadiness(owner, true).ready).toBe(true)
  reportClient(phone, false, false, false, challenge)
  expect(updateReadiness(owner, true).ready).toBe(false)
  reportClient(phone, false, true, false, challenge)
  vi.setSystemTime(Date.now() + 26_000)
  expect(updateReadiness(owner, true).ready).toBe(false)
  reportClient(phone, false, undefined, true)
  expect(updateReadiness(owner, true).ready).toBe(true)
})

it('waits for every active transfer and ignores duplicate completion notifications', () => {
  const first = countOperation(), second = countOperation()
  try {
    expect(updateReadiness(owner).ready).toBe(false)
    first(); first()
    expect(updateReadiness(owner).ready).toBe(false)
    second()
    expect(updateReadiness(owner).ready).toBe(true)
  } finally { first(); second() }
})
