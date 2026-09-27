import { useCallback, useEffect, useMemo, useState } from 'react'
import { learnedPaths, readWalks, WalkRecorder, WALK_STORAGE_KEY, type WalkSample } from '../walkedPaths'
import type { LatLng } from '../types'

export function useWalkedPaths(enabled: boolean) {
  const [recorder] = useState(() => {
    try { return new WalkRecorder(readWalks(localStorage.getItem(WALK_STORAGE_KEY))) }
    catch { return new WalkRecorder() }
  })
  const [paused, setPaused] = useState(false)
  const [snapshot, setSnapshot] = useState(() => ({ traces: recorder.traces, points: recorder.points, status: recorder.status }))
  const [storageError, setStorageError] = useState(false)
  const publish = useCallback(() => setSnapshot({ traces: recorder.traces, points: recorder.points, status: recorder.status }), [recorder])
  const persist = useCallback(() => {
    try { localStorage.setItem(WALK_STORAGE_KEY, JSON.stringify(recorder.traces)); setStorageError(false) }
    catch { setStorageError(true) }
  }, [recorder])
  const record = useCallback((sample: WalkSample) => {
    if (!enabled || paused || document.visibilityState !== 'visible') { recorder.end(); return }
    if (recorder.add(sample)) persist()
    publish()
  }, [enabled, paused, recorder, persist, publish])
  const setReference = useCallback((path: LatLng[]) => recorder.setReference(path), [recorder])
  useEffect(() => {
    const stop = () => { recorder.end(); publish() }
    document.addEventListener('visibilitychange', stop)
    return () => { document.removeEventListener('visibilitychange', stop); recorder.end() }
  }, [enabled, paused, recorder, publish])
  const paths = useMemo(() => learnedPaths(snapshot.traces), [snapshot.traces])
  return {
    paths, live: snapshot.points,
    status: paused ? 'Learning paused' : snapshot.status, paused, storageError,
    record, setReference,
    toggle: () => { recorder.end(); publish(); setPaused(value => !value) },
    clear: () => { recorder.clear(); persist(); publish() },
  }
}
