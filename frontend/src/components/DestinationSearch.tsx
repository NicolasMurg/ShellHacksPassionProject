import type { FormEvent } from 'react'

type Props = {
  text: string
  onChange: (text: string) => void
  onSearch: (text: string) => void
  onClear: () => void
}

export function DestinationSearch({ text, onChange, onSearch, onClear }: Props) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim()) onSearch(text.trim())
  }
  return (
      <form role="search" onSubmit={submit} className="flex h-13 items-center gap-1.5 rounded-full border border-line bg-raised pl-4 pr-1.5 focus-within:border-accent">
        <span aria-hidden className="text-lg text-muted">⌕</span>
        <input
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Address, place, or GC 150"
          aria-label="Address, place, or building and room"
          enterKeyHint="go"
          className="h-full min-w-0 flex-1 bg-transparent font-medium placeholder:text-muted focus:outline-none"
        />
        {text && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              onChange('')
              onClear()
            }}
            className="size-8 rounded-full text-xl text-muted hover:text-fg"
          >
            ×
          </button>
        )}
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Find the right entrance"
          className="grid size-11 place-items-center rounded-full bg-accent text-lg font-black text-accent-ink disabled:bg-high disabled:text-muted"
        >
          →
        </button>
      </form>
  )
}
