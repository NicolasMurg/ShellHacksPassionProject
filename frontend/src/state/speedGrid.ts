import { useSyncExternalStore } from 'react'
import { deserializeSpeedGrid, recordSpeedMeasurement, serializeSpeedGrid, type SpeedGrid } from '../../../shared/speedGrid'
import type { Fix, Motion } from '../motion'
import { collectWalkingMeasurement, initialWalkingWindow, type WalkingWindow } from '../walkingMeasurements'

export type SpeedGridSnapshot = {
  /** Sparse cell accumulators; only recordWalkingFix writes to this map. */
  cells: SpeedGrid
  storageUnavailable: boolean
}

type Store = { snapshot: SpeedGridSnapshot; window: WalkingWindow }
const stores = new Map<string, Store>()
const listeners = new Set<() => void>()
let activeKey: string | undefined

const storageKey = (userId?: string) => `doorstep.speedGrid.v1.${userId ? `user.${encodeURIComponent(userId)}` : 'guest'}`

function storeFor(userId?: string): Store {
  const key = storageKey(userId)
  const existing = stores.get(key)
  if (existing) return existing
  let saved: string | null = null
  let storageUnavailable = false
  try { saved = localStorage.getItem(key) } catch { storageUnavailable = true }
  const store: Store = {
    snapshot: { cells: deserializeSpeedGrid(saved), storageUnavailable },
    window: initialWalkingWindow,
  }
  stores.set(key, store)
  return store
}

/** Feed real GPS after travel-mode detection. Each account and the guest have separate histories. */
export function recordWalkingFix(fix: Fix, motion: Motion, userId?: string) {
  const key = storageKey(userId)
  const store = storeFor(userId)
  if (key !== activeKey) {
    store.window = initialWalkingWindow
    activeKey = key
  }
  const collected = collectWalkingMeasurement(store.window, fix, motion)
  store.window = collected.window
  if (!collected.measurement || recordSpeedMeasurement(store.snapshot.cells, collected.measurement) === 0) return

  let storageUnavailable = false
  try {
    // Persist S and W, not just their ratio, so the next visit keeps the same weighting.
    localStorage.setItem(key, serializeSpeedGrid(store.snapshot.cells))
  } catch {
    // A blocked or full browser store must not prevent calculations for this session.
    storageUnavailable = true
  }
  store.snapshot = { cells: store.snapshot.cells, storageUnavailable }
  listeners.forEach((listener) => listener())
}

export const getSpeedGridSnapshot = (userId?: string): SpeedGridSnapshot => storeFor(userId).snapshot

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Speeds saved on this browser for this user; unobserved cells have no allocated record. */
export function useSpeedGrid(userId?: string): SpeedGridSnapshot {
  const snapshot = () => getSpeedGridSnapshot(userId)
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
