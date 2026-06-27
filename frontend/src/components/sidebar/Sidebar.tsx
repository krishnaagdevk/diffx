import { useEffect, useRef, useState } from 'react'

const DEMO_PRESETS = [
  { label: 'Vite 5', url: 'https://github.com/vitejs/vite/pull/14290' },
  { label: 'React Router', url: 'https://github.com/remix-run/react-router/pull/10469' },
  { label: 'Prisma', url: 'https://github.com/prisma/prisma/pull/21832' },
]
import type { CommitMessageSettings } from '../../utils/settings'
import { Accordion } from './Accordion'
import { DiffSearch } from '../diff/DiffSearch'
import './Sidebar.css'

export type SidebarFile = {
  key: string
  path: string
  additions: number
  deletions: number
}

export type FileStatus = 'staged' | 'unstaged'

type SidebarProps = {
  stagedFiles: SidebarFile[]
  unstagedFiles: SidebarFile[]
  selectedFile: { path: string; status: FileStatus } | null
  repoPath: string | null
  hasQuizResult: boolean
  strictMode: boolean
  onToggleStrictMode: () => void
  strictModeNotice: string | null
  commitMessageSettings: CommitMessageSettings
  onSelectFile: (selection: { path: string; status: FileStatus }) => void
  onStageFile: (filePath: string) => void
  onUnstageFile: (filePath: string) => void
  onCommit: (message: string) => Promise<void>
  onPush: () => Promise<void>
  onStash: () => Promise<void>
  onPublicRepoLoaded: () => Promise<void>
  onSwitchRepo: (path: string) => Promise<void>
  isManualMode: boolean
  manualLabel: string | null
  onExitManualMode: () => Promise<void>
  onFetchPRDescription: () => void
  prDescription: { title: string; body: string } | null
  prLoading: boolean
  prError: string | null
  annotations: Record<string, string>
  onAnnotationChange: (filePath: string, note: string) => void
  branches: { name: string; current: boolean }[]
  branchBase: string
  branchCompare: string
  onBranchBaseChange: (v: string) => void
  onBranchCompareChange: (v: string) => void
  onFetchBranchDiff: () => void
  onLoadBranches: () => void
  branchDiff: string | null
  branchDiffLoading: boolean
  branchDiffError: string | null
  commitInputRef: React.RefObject<HTMLTextAreaElement | null>
  fileSearch: string
  fileSearchOpen: boolean
  onFileSearchChange: (v: string) => void
  onFileSearchToggle: () => void
  onFileSearchClose: () => void
  riskScore: { score: number; reasons: string[] } | null
  depChanges: string[]
  criticalUnacknowledged: number
}

export function Sidebar({
  stagedFiles,
  unstagedFiles,
  selectedFile,
  repoPath,
  hasQuizResult,
  strictMode,
  onToggleStrictMode,
  strictModeNotice,
  commitMessageSettings,
  onSelectFile,
  onStageFile,
  onUnstageFile,
  onCommit,
  onPush,
  onStash,
  onPublicRepoLoaded,
  onSwitchRepo,
  isManualMode,
  manualLabel,
  onExitManualMode,
  annotations,
  onAnnotationChange,
  branches,
  branchBase,
  branchCompare,
  onBranchBaseChange,
  onBranchCompareChange,
  onFetchBranchDiff,
  onLoadBranches,
  branchDiff,
  branchDiffLoading,
  branchDiffError,
  commitInputRef,
  fileSearch,
  fileSearchOpen,
  onFileSearchChange,
  onFileSearchToggle,
  onFileSearchClose,
  riskScore,
  criticalUnacknowledged,
}: SidebarProps) {
  const totalFiles = stagedFiles.length + unstagedFiles.length
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const internalCommitRef = useRef<HTMLTextAreaElement>(null)
  const resolvedCommitRef = (commitInputRef as React.RefObject<HTMLTextAreaElement>) ?? internalCommitRef
  const [commitLoading, setCommitLoading] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [pushLoading, setPushLoading] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const [autoGenerateLoading, setAutoGenerateLoading] = useState(false)
  const [stashLoading, setStashLoading] = useState(false)
  const [stashError, setStashError] = useState<string | null>(null)
  const [stashConfirmOpen, setStashConfirmOpen] = useState(false)

  // Public Git URL State
  const [publicUrl, setPublicUrl] = useState('')
  const [publicLoading, setPublicLoading] = useState(false)
  const [publicError, setPublicError] = useState<string | null>(null)

  // Repo switcher
  const [repoSwitchInput, setRepoSwitchInput] = useState('')
  const [repoSwitchLoading, setRepoSwitchLoading] = useState(false)
  const [repoSwitchError, setRepoSwitchError] = useState<string | null>(null)
  const [repoSwitchOpen, setRepoSwitchOpen] = useState(false)

  // Branch compare
  const [branchOpen, setBranchOpen] = useState(false)

  // HITL: high-risk push confirmation
  const [pushRiskConfirmOpen, setPushRiskConfirmOpen] = useState(false)

  // Commit gate unlock animation
  const prevHasQuizResult = useRef(hasQuizResult)
  const [showUnlockAnim, setShowUnlockAnim] = useState(false)
  useEffect(() => {
    if (!prevHasQuizResult.current && hasQuizResult && strictMode) {
      setShowUnlockAnim(true)
      const t = setTimeout(() => setShowUnlockAnim(false), 1800)
      return () => clearTimeout(t)
    }
    prevHasQuizResult.current = hasQuizResult
  }, [hasQuizResult, strictMode])

  // Annotation for selected file
  const selectedAnnotation = selectedFile ? (annotations[selectedFile.path] ?? '') : ''

  const canCommit = Boolean(repoPath) && stagedFiles.length > 0
  // HITL gate: quiz must pass AND no unacknowledged critical AI findings
  const canCommitStrict = canCommit && (!strictMode || hasQuizResult) && criticalUnacknowledged === 0
  const canPush = Boolean(repoPath) && (!strictMode || hasQuizResult)
  const hasChanges = totalFiles > 0
  const isHighRisk = (riskScore?.score ?? 0) >= 8

  const handleLoadPublicUrl = async (urlOverride?: string) => {
    const url = (urlOverride ?? publicUrl).trim()
    if (!url) return
    if (urlOverride) setPublicUrl(urlOverride)
    setPublicLoading(true)
    setPublicError(null)
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/ai/public-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!response.ok) {
        let errorMessage = `Failed to load public repository (${response.status})`
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          try {
            const data = (await response.json()) as { error?: string }
            if (data?.error) errorMessage = data.error
          } catch {
            // Ignore JSON parse error in error block
          }
        } else if (response.status === 404) {
          errorMessage = 'API endpoint not found (404). Please ensure VITE_API_URL is configured to point to your Render backend URL, not your Vercel frontend URL.'
        }
        throw new Error(errorMessage)
      }
      setPublicUrl('')
      await onPublicRepoLoaded()
    } catch (error) {
      setPublicError(error instanceof Error ? error.message : 'Failed to load URL.')
    } finally {
      setPublicLoading(false)
    }
  }

  const handleCommit = async () => {
    const message = commitMessage.trim()
    if (!message) {
      setCommitError('Commit message is required.')
      return
    }
    setCommitLoading(true)
    setCommitError(null)
    try {
      await onCommit(message)
      setCommitMessage('')
      setCommitOpen(false)
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : 'Failed to commit.')
    } finally {
      setCommitLoading(false)
    }
  }

  const handlePush = async () => {
    setPushLoading(true)
    setPushError(null)
    try {
      await onPush()
    } catch (error) {
      setPushError(error instanceof Error ? error.message : 'Failed to push.')
    } finally {
      setPushLoading(false)
    }
  }

  const handleAutoGenerate = async () => {
    if (!hasChanges) return
    setAutoGenerateLoading(true)
    setCommitError(null)
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/ai/commit-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commitConfig: {
            followPreviousStyle: commitMessageSettings.followPreviousStyle,
            style: commitMessageSettings.style,
            includeBody: commitMessageSettings.includeBody,
            customRules: commitMessageSettings.customRules,
          },
        }),
      })
      if (!response.ok) {
        let errorMessage = `Failed to generate commit message (${response.status})`
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          try {
            const data = (await response.json()) as { error?: string }
            if (data?.error) errorMessage = data.error
          } catch {
            // Ignore
          }
        } else if (response.status === 404) {
          errorMessage = 'API endpoint not found (404). Please ensure VITE_API_URL is configured to point to your Render backend URL, not your Vercel frontend URL.'
        }
        throw new Error(errorMessage)
      }
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server did not return JSON. Please check your backend configuration.')
      }
      const data = (await response.json()) as { subject?: string; body?: string | null }
      if (typeof data.subject === 'string') {
        const fullMessage = data.body
          ? `${data.subject}\n\n${data.body}`
          : data.subject
        setCommitMessage(fullMessage)
      } else {
        throw new Error('Invalid response from server')
      }
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : 'Failed to generate commit message.')
    } finally {
      setAutoGenerateLoading(false)
    }
  }

  const handleStash = async () => {
    setStashLoading(true)
    setStashError(null)
    try {
      await onStash()
      setStashConfirmOpen(false)
    } catch (error) {
      setStashError(error instanceof Error ? error.message : 'Failed to stash.')
    } finally {
      setStashLoading(false)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">DIFFX</div>
      </div>

      {/* Manual mode banner — stays until user explicitly exits */}
      {isManualMode && (
        <div className="manual-mode-banner">
          <span className="manual-mode-label" title={manualLabel ?? ''}>
            📎 {manualLabel ?? 'Public diff'}
          </span>
          <button
            type="button"
            className="manual-mode-exit"
            onClick={() => void onExitManualMode()}
            title="Return to local repo diff"
          >
            ← Local
          </button>
        </div>
      )}

      <div className="sidebar-public-url">
        <input
          type="text"
          value={publicUrl}
          onChange={(e) => setPublicUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && publicUrl.trim() && !publicLoading) void handleLoadPublicUrl() }}
          placeholder="GitHub PR/Commit URL..."
          disabled={publicLoading}
          className="public-url-input"
        />
        <button
          type="button"
          onClick={() => void handleLoadPublicUrl()}
          disabled={publicLoading || !publicUrl.trim()}
          className="public-url-btn"
        >
          {publicLoading ? '...' : 'Load'}
        </button>
      </div>
      {publicError ? <div className="public-url-error">{publicError}</div> : null}

      {/* Demo presets */}
      <div className="demo-presets">
        <span className="demo-label">Demo:</span>
        {DEMO_PRESETS.map(({ label, url }) => (
          <button
            key={label}
            type="button"
            className="demo-preset-btn"
            disabled={publicLoading}
            onClick={() => void handleLoadPublicUrl(url)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Repo path + switcher */}
      <div className="sidebar-repo-row">
        {repoPath ? <div className="sidebar-cwd" title={repoPath}>{repoPath.split(/[\\/]/).pop()}</div> : null}
        <button type="button" className="sidebar-icon-btn" onClick={() => setRepoSwitchOpen(o => !o)} title="Switch repository">⇄</button>
        <button type="button" className="sidebar-icon-btn" onClick={onFileSearchToggle} title="Search files (Ctrl+F)">⌕</button>
      </div>
      {repoSwitchOpen && (
        <div className="sidebar-repo-switch">
          <input
            type="text"
            className="public-url-input"
            placeholder="Absolute path to repo…"
            value={repoSwitchInput}
            onChange={e => setRepoSwitchInput(e.target.value)}
            onKeyDown={async e => {
              if (e.key === 'Enter') {
                setRepoSwitchLoading(true)
                setRepoSwitchError(null)
                try { await onSwitchRepo(repoSwitchInput); setRepoSwitchOpen(false); setRepoSwitchInput('') }
                catch (err) { setRepoSwitchError(err instanceof Error ? err.message : 'Failed') }
                finally { setRepoSwitchLoading(false) }
              }
            }}
          />
          <button
            type="button"
            className="public-url-btn"
            disabled={repoSwitchLoading || !repoSwitchInput.trim()}
            onClick={async () => {
              setRepoSwitchLoading(true)
              setRepoSwitchError(null)
              try { await onSwitchRepo(repoSwitchInput); setRepoSwitchOpen(false); setRepoSwitchInput('') }
              catch (err) { setRepoSwitchError(err instanceof Error ? err.message : 'Failed') }
              finally { setRepoSwitchLoading(false) }
            }}
          >
            {repoSwitchLoading ? '…' : 'Switch'}
          </button>
        </div>
      )}
      {repoSwitchError && <div className="public-url-error">{repoSwitchError}</div>}

      {/* File search */}
      {fileSearchOpen && (
        <DiffSearch
          value={fileSearch}
          onChange={onFileSearchChange}
          onClose={onFileSearchClose}
          matchCount={
            [...stagedFiles, ...unstagedFiles].filter(f =>
              f.path.toLowerCase().includes(fileSearch.toLowerCase())
            ).length
          }
        />
      )}

      {/* Branch compare */}
      <div className="sidebar-branch-row">
        <button
          type="button"
          className="sidebar-branch-toggle"
          onClick={() => { setBranchOpen(o => !o); if (!branchOpen) onLoadBranches() }}
        >
          ⎇ Branch compare {branchOpen ? '▲' : '▼'}
        </button>
      </div>
      {branchOpen && (
        <div className="sidebar-branch-panel">
          <div className="branch-selects">
            <select value={branchBase} onChange={e => onBranchBaseChange(e.target.value)} className="branch-select">
              <option value="">Base branch…</option>
              {branches.map(b => <option key={b.name} value={b.name}>{b.name}{b.current ? ' ●' : ''}</option>)}
            </select>
            <span className="branch-arrow">→</span>
            <select value={branchCompare} onChange={e => onBranchCompareChange(e.target.value)} className="branch-select">
              <option value="">Compare…</option>
              {branches.map(b => <option key={b.name} value={b.name}>{b.name}{b.current ? ' ●' : ''}</option>)}
            </select>
          </div>
          <button
            type="button"
            className="public-url-btn"
            disabled={branchDiffLoading || !branchBase || !branchCompare}
            onClick={onFetchBranchDiff}
          >
            {branchDiffLoading ? 'Loading…' : 'Compare'}
          </button>
          {branchDiffError && <div className="public-url-error">{branchDiffError}</div>}
          {branchDiff && !branchDiffLoading && (
            <div className="branch-diff-summary">
              {branchDiff.split('\n').filter(l => l.startsWith('diff --git')).length} file(s) differ
              <span className="branch-diff-lines">
                &nbsp;·&nbsp;
                +{(branchDiff.match(/^\+[^+]/gm) || []).length}&nbsp;
                −{(branchDiff.match(/^-[^-]/gm) || []).length}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="sidebar-content">
        {totalFiles === 0 ? (
          <div className="sidebar-empty">No file changes</div>
        ) : (
          <>
          {(() => {
            const q = fileSearch.toLowerCase()
            const filteredStaged = stagedFiles.filter(f => !q || f.path.toLowerCase().includes(q))
            const filteredUnstaged = unstagedFiles.filter(f => !q || f.path.toLowerCase().includes(q))
            return (<>
            <Accordion title="Staged" count={filteredStaged.length} defaultOpen={true}>
              {filteredStaged.length === 0 ? (
                <div className="sidebar-empty-section">{fileSearch ? 'No matches' : 'No staged changes'}</div>
              ) : (
                filteredStaged.map((file) => (
                  <div
                    key={file.key}
                    className={`file-card ${
                      selectedFile?.path === file.path && selectedFile.status === 'staged'
                        ? 'is-active'
                        : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="file-card-main"
                      onClick={() => onSelectFile({ path: file.path, status: 'staged' })}
                    >
                      <div className="file-row">
                        <div className="file-name">{file.path}</div>
                        <div className="file-stats">
                          <span className="file-add">+{file.additions}</span>
                          <span className="file-del">-{file.deletions}</span>
                        </div>
                      </div>
                    </button>
                    <div className="file-actions">
                      <button
                        type="button"
                        className="file-action"
                        onClick={(event) => {
                          event.stopPropagation()
                          onUnstageFile(file.path)
                        }}
                        aria-label="Unstage file"
                        title="Unstage file"
                      >
                        −
                      </button>
                    </div>
                  </div>
                ))
              )}
            </Accordion>

            <Accordion title="Unstaged" count={filteredUnstaged.length} defaultOpen={true}>
              {filteredUnstaged.length === 0 ? (
                <div className="sidebar-empty-section">{fileSearch ? 'No matches' : 'No unstaged changes'}</div>
              ) : (
                filteredUnstaged.map((file) => (
                  <div
                    key={file.key}
                    className={`file-card ${
                      selectedFile?.path === file.path && selectedFile.status === 'unstaged'
                        ? 'is-active'
                        : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="file-card-main"
                      onClick={() => onSelectFile({ path: file.path, status: 'unstaged' })}
                    >
                      <div className="file-row">
                        <div className="file-name">{file.path}</div>
                        <div className="file-stats">
                          <span className="file-add">+{file.additions}</span>
                          <span className="file-del">-{file.deletions}</span>
                        </div>
                      </div>
                    </button>
                    <div className="file-actions">
                      <button
                        type="button"
                        className="file-action"
                        onClick={(event) => {
                          event.stopPropagation()
                          onStageFile(file.path)
                        }}
                        aria-label="Stage file"
                        title="Stage file"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))
              )}
            </Accordion>
            </>)
          })()}
          </>
        )}

        {/* Inline annotation for selected file */}
        {selectedFile && (
          <div className="annotation-panel">
            <div className="annotation-label">📝 Note — {selectedFile.path.split('/').pop()}</div>
            <textarea
              className="annotation-textarea"
              placeholder="Add a personal note about this file's changes…"
              value={selectedAnnotation}
              onChange={e => onAnnotationChange(selectedFile.path, e.target.value)}
              rows={3}
            />
          </div>
        )}
      </div>
      <div className="sidebar-actions">
        <div className="sidebar-separator" />
        <button
          type="button"
          className="sidebar-strict-mode"
          aria-pressed={strictMode}
          onClick={onToggleStrictMode}
          title={
            strictMode
              ? "Strict mode is on. You can't push code without taking a quiz."
              : 'Strict mode is off. Click to require a quiz before pushing.'
          }
          aria-label="Strict mode"
        >
          <span>STRICT MODE</span>
          <span className="strict-toggle" aria-hidden="true">
            <span className="strict-toggle-track">
              <span className="strict-toggle-thumb" />
            </span>
            <span className="strict-toggle-label">{strictMode ? 'ON' : 'OFF'}</span>
          </span>
        </button>
        {strictModeNotice ? (
          <div className="sidebar-strict-notice" role="status" aria-live="polite">
            {strictModeNotice}
          </div>
        ) : null}
        <div className="sidebar-action-row">
          {/* HITL Gate 1 — commit locked until quiz passed AND all AI criticals acknowledged */}
          <button
            type="button"
            className={[
              'sidebar-action-btn',
              strictMode && !hasQuizResult ? 'commit-btn-locked' : '',
              strictMode && hasQuizResult && showUnlockAnim ? 'commit-btn-unlocking' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => {
              if (!canCommitStrict) return
              setCommitOpen(true)
              setCommitError(null)
            }}
            disabled={!canCommitStrict || commitLoading}
            title={
              strictMode && !hasQuizResult
                ? '🔒 Take a quiz on your diff before committing'
                : criticalUnacknowledged > 0
                  ? `🔒 Acknowledge ${criticalUnacknowledged} critical AI finding(s) in the Review tab`
                  : 'Commit staged changes'
            }
          >
            {strictMode && !hasQuizResult
              ? '🔒 Commit'
              : criticalUnacknowledged > 0
                ? `🔒 Commit (${criticalUnacknowledged})`
                : strictMode && hasQuizResult
                  ? '✓ Commit'
                  : 'Commit'}
          </button>

          {/* HITL Gate 2 — push requires explicit confirmation when risk ≥ 8 */}
          <button
            type="button"
            className="sidebar-action-btn"
            onClick={() => {
              if (isHighRisk && canPush) { setPushRiskConfirmOpen(true); return }
              void handlePush()
            }}
            disabled={!canPush || pushLoading}
            title={
              !canPush
                ? strictMode ? "Complete a quiz before pushing." : 'Nothing to push'
                : isHighRisk ? `⚠ Risk ${riskScore!.score}/10 — confirmation required` : 'Push to remote'
            }
          >
            {pushLoading ? '…' : isHighRisk && canPush ? '⚠ Push' : 'Push'}
          </button>

          <button
            type="button"
            className="sidebar-action-btn"
            onClick={() => { if (!hasChanges) return; setStashConfirmOpen(true); setStashError(null) }}
            disabled={!hasChanges || stashLoading}
          >
            Stash
          </button>
        </div>

        {/* HITL: critical findings notice */}
        {criticalUnacknowledged > 0 && (
          <div className="hitl-critical-notice">
            🔒 {criticalUnacknowledged} critical finding{criticalUnacknowledged > 1 ? 's' : ''} must be reviewed in the <strong>Review</strong> tab before committing.
          </div>
        )}

        {/* HITL: high-risk push confirmation */}
        {pushRiskConfirmOpen && (
          <div className="sidebar-commit hitl-risk-confirm">
            <div className="hitl-risk-header">
              ⚠ Risk Score: {riskScore?.score}/10
            </div>
            <div className="hitl-risk-reasons">
              {riskScore?.reasons.map((r, i) => <div key={i}>· {r}</div>)}
            </div>
            <div className="hitl-risk-question">
              You are pushing high-risk changes. Confirm you have reviewed them.
            </div>
            <div className="sidebar-commit-actions">
              <button
                type="button"
                onClick={() => { setPushRiskConfirmOpen(false); void handlePush() }}
                disabled={pushLoading}
              >
                {pushLoading ? '…' : 'I understand, Push'}
              </button>
              <button type="button" onClick={() => setPushRiskConfirmOpen(false)} disabled={pushLoading}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {pushError ? <div className="sidebar-action-error">{pushError}</div> : null}
        {stashError ? <div className="sidebar-action-error">{stashError}</div> : null}
        {commitOpen ? (
          <div className="sidebar-commit">
            <label className="sidebar-commit-label" htmlFor="sidebar-commit-message">
              Commit message
            </label>
            <textarea
              ref={resolvedCommitRef}
              id="sidebar-commit-message"
              rows={3}
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Describe what changed"
              disabled={commitLoading}
            />
            {commitError ? <div className="sidebar-action-error">{commitError}</div> : null}
            <div className="sidebar-commit-actions">
              <button type="button" onClick={() => void handleCommit()} disabled={commitLoading}>
                {commitLoading ? 'Committing…' : 'Commit'}
              </button>
              <button
                type="button"
                onClick={() => void handleAutoGenerate()}
                disabled={autoGenerateLoading || !hasChanges}
              >
                {autoGenerateLoading ? 'Generating…' : 'Auto-generate'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCommitOpen(false)
                  setCommitError(null)
                }}
                disabled={commitLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {stashConfirmOpen ? (
          <div className="sidebar-commit">
            <div className="sidebar-stash-confirm">
              Are you sure you want to stash all changes? This will save your current changes and revert to a clean working directory.
            </div>
            <div className="sidebar-commit-actions">
              <button
                type="button"
                onClick={() => void handleStash()}
                disabled={stashLoading}
              >
                {stashLoading ? 'Stashing…' : 'Yes, Stash'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStashConfirmOpen(false)
                  setStashError(null)
                }}
                disabled={stashLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
