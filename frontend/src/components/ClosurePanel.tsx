import { useState } from 'react'
import type { LatLng, RoadClosure, User } from '../types'
import { Button, Field, Notice, inputClass } from './ui'

type Props = {
  user: User
  draft: LatLng[]
  closures: RoadClosure[]
  onUndo: () => void
  onSubmit: (reason: string) => Promise<void>
  onRemove: (id: string) => void
  onDone: () => void
}

/** Report a closed road by tapping along it. Shared with every user. */
export function ClosurePanel({ user, draft, closures, onUndo, onSubmit, onRemove, onDone }: Props) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async () => {
    setSaving(true)
    try {
      await onSubmit(reason.trim() || 'Road closed')
      setReason('')
      setError(undefined)
    } catch (e) { setError((e as Error).message) } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold text-muted">Help others spot access problems</p>
          <h1 className="m-0 text-xl font-extrabold tracking-tight">Report a closed road</h1>
        </div>
        <Button className="h-9 text-sm" onClick={onDone}>
          Done
        </Button>
      </header>

      <Notice tone={draft.length >= 2 ? 'success' : 'info'}>
        {draft.length === 0
          ? 'Tap the map along the closed stretch of road.'
          : `${draft.length} point${draft.length === 1 ? '' : 's'} marked. ${draft.length < 2 ? 'Add at least one more.' : 'Keep tapping or submit.'}`}
      </Notice>

      {error && <Notice tone="error">{error}</Notice>}
      <Field label="What's going on?">
        <input
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Construction, event, flooding"
        />
      </Field>

      <div className="flex gap-2">
        <Button className="flex-1" disabled={draft.length === 0} onClick={onUndo}>
          Undo point
        </Button>
        <Button variant="primary" className="flex-1" disabled={draft.length < 2 || saving} onClick={submit}>
          {saving ? 'Saving…' : 'Submit closure'}
        </Button>
      </div>

      {closures.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-sm font-bold text-muted">Reported closures</h2>
          {closures.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3.5 py-2.5">
              <span>
                <span className="block text-sm font-semibold">⛔ {c.reason}</span>
                <span className="text-xs text-muted">
                  by {c.reportedBy} · {new Date(c.createdAt).toLocaleDateString()}
                </span>
              </span>
              {c.ownerId === user.id && (
                <Button variant="quiet" className="h-8 px-2 text-sm" onClick={() => onRemove(c.id)}>
                  Reopen
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  )
}
