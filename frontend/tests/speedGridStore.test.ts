import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { cellCenter } from '../../shared/grid'
import { offset } from '../../shared/geo'
import { serializeSpeedGrid } from '../../shared/speedGrid'
import { initialMotion, stepMotion, type Motion } from '../src/motion'
import { getSpeedGridSnapshot, recordWalkingFix } from '../src/state/speedGrid'

const saved = new Map<string, string>()
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let storageFull = false
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (storageFull) throw new Error('Quota exceeded')
        saved.set(key, value)
      },
    },
  })
})
beforeEach(() => { saved.clear(); storageFull = false })
afterAll(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

const start = cellCenter({ row: 330, col: 705 })
const walking: Motion = { ...initialMotion, mode: 'walking', speed: 1.2 }
const fixAt = (second: number, speed: number) => ({
  ...offset(start, 0, second * speed), t: second * 1000, speed, accuracy: 2,
})
const walkWindow = (userId: string | undefined, speed: number) => {
  for (let second = 0; second <= 5; second++) recordWalkingFix(fixAt(second, speed), walking, userId)
  return getSpeedGridSnapshot(userId)
}

describe('personal grid speed collection', () => {
  test('the existing detector feeds learned speeds only after a sustained walk', () => {
    let motion = initialMotion
    const userId = 'detector-integration'
    for (let second = 0; second <= 6; second++) {
      const fix = fixAt(second, 1.2)
      motion = stepMotion(motion, fix, 'walkway')
      recordWalkingFix(fix, motion, userId)
    }
    expect(getSpeedGridSnapshot(userId).cells.size).toBe(0)
    for (let second = 7; second <= 25; second++) {
      const fix = fixAt(second, 1.2)
      motion = stepMotion(motion, fix, 'walkway')
      recordWalkingFix(fix, motion, userId)
    }
    const { cells } = getSpeedGridSnapshot(userId)
    expect(cells.size).toBeGreaterThan(0)
    for (const cell of cells.values()) expect(cell.sum / cell.weight).toBeCloseTo(1.2, 8)
  })

  test('accounts and the guest keep separate averages and saved records', () => {
    const a = walkWindow('account-a', 1.2)
    const b = walkWindow('account-b', 1.6)
    const guest = walkWindow(undefined, 1.0)
    for (const [snapshot, expected] of [[a, 1.2], [b, 1.6], [guest, 1.0]] as const) {
      expect(snapshot.cells.size).toBeGreaterThan(0)
      for (const cell of snapshot.cells.values()) expect(cell.sum / cell.weight).toBeCloseTo(expected, 8)
    }
    expect(a.cells).not.toBe(b.cells)
    expect(saved.has('doorstep.speedGrid.v1.user.account-a')).toBe(true)
    expect(saved.has('doorstep.speedGrid.v1.user.account-b')).toBe(true)
    expect(saved.has('doorstep.speedGrid.v1.guest')).toBe(true)
  })

  test('replaying the same GPS timestamp cannot add weight twice', () => {
    const previous = walkWindow('duplicate', 1.2)
    const serialized = serializeSpeedGrid(previous.cells)
    recordWalkingFix(fixAt(5, 1.2), walking, 'duplicate')
    expect(getSpeedGridSnapshot('duplicate')).toBe(previous)
    expect(serializeSpeedGrid(previous.cells)).toBe(serialized)
  })

  test('restores both accumulators for a returning account', () => {
    saved.set('doorstep.speedGrid.v1.user.returning', serializeSpeedGrid(new Map([[330705, { sum: 12, weight: 10 }]])))
    expect(getSpeedGridSnapshot('returning').cells.get(330705)).toEqual({ sum: 12, weight: 10 })
    expect(getSpeedGridSnapshot('different-account').cells.size).toBe(0)
  })

  test('a full browser store keeps calculations available and reports unsaved history', () => {
    storageFull = true
    const snapshot = walkWindow('full-storage', 1.2)
    expect(snapshot.cells.size).toBeGreaterThan(0)
    expect(snapshot.storageUnavailable).toBe(true)
  })
})
