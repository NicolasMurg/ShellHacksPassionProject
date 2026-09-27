import { useEffect, useState } from 'react'
import * as api from '../api'
import type { LatLng } from '../types'

type Plan = Awaited<ReturnType<typeof api.planArrival>>
export function useArrival(input: Omit<api.ArrivalInput, 'stopPoint'> | undefined, token: string | undefined, revision: string) {
  const [moving, setMoving] = useState(false)
  const [draft, setDraft] = useState<LatLng>()
  const [selected, setSelected] = useState<string>()
  const [confirmation, setConfirmation] = useState<string>()
  const [version, setVersion] = useState(0)
  const key = input ? JSON.stringify({ input: { ...input, stopPoint: draft }, token, revision, version }) : undefined
  const [result, setResult] = useState<{ key: string; data?: Plan; error?: string }>()
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const request = JSON.parse(key) as { input: api.ArrivalInput; token?: string }
      api.planArrival(request.input, request.token, controller.signal).then(data => {
        if (!controller.signal.aborted) setResult({ key, data })
      }).catch((e: Error) => { if (!controller.signal.aborted) setResult({ key, error: e.message }) })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key])
  const data = result?.key === key ? result?.data : undefined
  const option = data?.options.find(o => o.id === selected) ?? data?.options[0]
  return {
    data, option, moving, draft, started: !!input, loading: !!key && result?.key !== key,
    error: result?.key === key ? result?.error : undefined,
    confirmed: !!option && confirmation === `${key}|${option.id}`,
    reset: () => { setMoving(false); setDraft(undefined); setSelected(undefined); setConfirmation(undefined); setResult(undefined) },
    move: () => { setMoving(true); setConfirmation(undefined) },
    cancelMove: () => setMoving(false),
    moveTo: (p: LatLng) => { setDraft(p); setMoving(false); setSelected(undefined); setConfirmation(undefined) },
    select: (id: string) => { setSelected(id); setConfirmation(undefined) },
    confirm: () => setConfirmation(`${key}|${option?.id}`),
    change: () => setConfirmation(undefined),
    refresh: () => { setVersion(v => v + 1); setConfirmation(undefined) },
    suggest: () => { setDraft(undefined); setMoving(false); setSelected(undefined); setConfirmation(undefined); setVersion(v => v + 1) },
  }
}
export type ArrivalState = ReturnType<typeof useArrival>
