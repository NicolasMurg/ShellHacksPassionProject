import { useCallback, useEffect, useState } from 'react'
import * as api from '../api'

export function usePublicStops(token?: string, admin = false) {
  const [revision, setRevision] = useState(0)
  const [queue, setQueue] = useState(false)
  const [result, setResult] = useState<{ key: string; stops: api.PublicStop[]; nextCursor: string | null; error?: string }>()
  const [loadingMore, setLoadingMore] = useState(false)
  const key = JSON.stringify([token, revision, queue && admin, admin])
  const load = useCallback((before?: string, signal?: AbortSignal) =>
    admin && token ? queue ? api.getStopReviewQueue(token, before, signal) : api.getAllPublicStops(token, before, signal)
      : api.getPublicStops(token, before, signal), [admin, token, queue])
  useEffect(() => {
    const controller = new AbortController()
    load(undefined, controller.signal).then(page => { if (!controller.signal.aborted) setResult({ key, ...page }) })
      .catch((error: Error) => { if (!controller.signal.aborted) setResult({ key, stops: [], nextCursor: null, error: error.message }) })
    return () => controller.abort()
  }, [key, load])
  const current = result?.key === key ? result : undefined
  return {
    stops: current?.stops ?? [], error: current?.error, loading: !current, queue: queue && admin, setQueue,
    refresh: () => setRevision(value => value + 1), loadingMore, hasMore: !!current?.nextCursor,
    loadMore: async () => {
      if (!current?.nextCursor || loadingMore) return
      setLoadingMore(true)
      try {
        const page = await load(current.nextCursor)
        setResult(previous => previous?.key === key ? { key, stops: [...previous.stops, ...page.stops], nextCursor: page.nextCursor } : previous)
      } catch (error) { setResult(previous => previous?.key === key ? { ...previous, error: (error as Error).message } : previous) }
      finally { setLoadingMore(false) }
    },
    update: (stop: api.PublicStop) => setResult(previous => previous?.key === key
      ? { ...previous, stops: [stop, ...previous.stops.filter(s => s.id !== stop.id)] } : previous),
  }
}
