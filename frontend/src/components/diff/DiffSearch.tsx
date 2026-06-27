import { useEffect, useRef } from 'react'
import './DiffSearch.css'

type DiffSearchProps = {
  value: string
  onChange: (value: string) => void
  onClose: () => void
  matchCount: number
}

export function DiffSearch({ value, onChange, onClose, matchCount }: DiffSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="diff-search-bar" role="search">
      <span className="diff-search-icon">🔍</span>
      <input
        ref={inputRef}
        className="diff-search-input"
        type="text"
        placeholder="Filter files…"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose()
        }}
        aria-label="Filter changed files"
      />
      {value && (
        <span className="diff-search-count">
          {matchCount} {matchCount === 1 ? 'file' : 'files'}
        </span>
      )}
      <button
        type="button"
        className="diff-search-close"
        onClick={onClose}
        aria-label="Close search"
      >
        ✕
      </button>
    </div>
  )
}
