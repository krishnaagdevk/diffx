import { useEffect } from 'react'

export type ShortcutActions = {
  onNextFile: () => void
  onPrevFile: () => void
  onStageFile: () => void
  onUnstageFile: () => void
  onFocusCommit: () => void
  onToggleSearch: () => void
}

export function useKeyboardShortcuts(actions: ShortcutActions, enabled = true) {
  useEffect(() => {
    if (!enabled) return

    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      // Don't fire when typing in inputs / textareas
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
        // Allow Escape from inputs
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }

      switch (e.key) {
        case 'j':
          e.preventDefault()
          actions.onNextFile()
          break
        case 'k':
          e.preventDefault()
          actions.onPrevFile()
          break
        case 's':
          e.preventDefault()
          actions.onStageFile()
          break
        case 'u':
          e.preventDefault()
          actions.onUnstageFile()
          break
        case 'c':
          e.preventDefault()
          actions.onFocusCommit()
          break
        case 'f':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            actions.onToggleSearch()
          }
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, actions])
}
