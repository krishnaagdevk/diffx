import '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useMemo } from 'react'

import './DiffViewer.css'

type DiffViewerProps = {
  selectedFile: FileDiffMetadata | null
  error: string | null
  hasChanges: boolean
  loading: boolean
  diffMode: 'unified' | 'split'
}

export function DiffViewer({ selectedFile, error, hasChanges, loading, diffMode }: DiffViewerProps) {
  const fileOptions = useMemo(
    () => ({
      theme: { dark: 'pierre-dark', light: 'pierre-light' } as const,
      themeType: 'system' as const,
      diffStyle: diffMode,
      diffIndicators: 'bars' as const,
      disableBackground: false,
      hunkSeparators: 'line-info' as const,
      expandUnchanged: false,
      expansionLineCount: 80,
      lineDiffType: 'word-alt' as const,
      maxLineDiffLength: 1000,
      disableLineNumbers: false,
      tokenizeMaxLineLength: 1000,
      disableFileHeader: true,
      overflow: 'wrap' as const,
    }),
    [diffMode]
  )

  return (
    <div className="diff-viewer">
      {error ? (
        <div className="diff-empty">Error: {error}</div>
      ) : !hasChanges ? (
        <div className="diff-empty diff-onboarding">
          <div className="onboarding-inner">
            <div className="onboarding-title">DIFFX</div>
            <div className="onboarding-tagline">The cognitive code review tool that locks your commits until you understand your changes.</div>
            {/* <div className="onboarding-steps">
              <div className="onboarding-step"><span className="onboarding-num">01</span><span>Edit files in your repo — diffs appear here live</span></div>
              <div className="onboarding-step"><span className="onboarding-num">02</span><span>Open the <strong>Quiz</strong> tab → take a quiz on your own changes</span></div>
              <div className="onboarding-step"><span className="onboarding-num">03</span><span>Pass the quiz → the <strong>🔒 Commit</strong> button unlocks</span></div>
              <div className="onboarding-step"><span className="onboarding-num">04</span><span>Or paste a GitHub PR URL in the sidebar to review any public diff</span></div>
            </div> */}
            <div className="onboarding-shortcuts">
              <span>j/k — next/prev file</span>
              <span>s — stage</span>
              <span>u — unstage</span>
              <span>c — focus commit</span>
              <span>Ctrl+F — search files</span>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="diff-empty">Loading selected file diff…</div>
      ) : selectedFile == null ? (
        <div className="diff-empty">Select a file to view its diff.</div>
      ) : (
        <section className="diff-surface" aria-label="File diff">
          <div className="diff-scroll">
            <FileDiff fileDiff={selectedFile} options={fileOptions} />
          </div>
        </section>
      )}
    </div>
  )
}
