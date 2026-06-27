import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'

import { getGitDiff, getGitDiffStaged } from '../git/gitDiff'

type DiffSnapshot = {
  unstaged: string
  staged: string
  updatedAt: string
}

let latest: DiffSnapshot = {
  unstaged: '',
  staged: '',
  updatedAt: new Date(0).toISOString(),
}

let currentRepoPath: string | null = null
let localRepoPath: string | null = null     // the real on-disk repo path being watched
let activeWatcher: FSWatcher | null = null
let manualMode = false          // true = watcher events must not overwrite latest
let manualRepoLabel: string | null = null   // display name when in manual mode

const debounceMs = 150
let pendingTimer: NodeJS.Timeout | null = null

async function refresh(repoPath: string) {
  // Never let a background watcher event overwrite a manually loaded diff
  if (manualMode) return
  try {
    const [unstaged, staged] = await Promise.all([
      getGitDiff(repoPath),
      getGitDiffStaged(repoPath),
    ])
    latest = {
      unstaged,
      staged,
      updatedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.error('Failed to compute git diff:', error)
  }
}

function scheduleRefresh(repoPath: string) {
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => void refresh(repoPath), debounceMs)
}

export async function startDiffWatcher(repoPath: string) {
  manualMode = false
  manualRepoLabel = null
  currentRepoPath = repoPath
  localRepoPath = repoPath
  await refresh(repoPath)

  const watcher = chokidar.watch(repoPath, {
    ignored: [/(^|[/\\])\../, /node_modules/, /dist/, /build/],
    ignoreInitial: true,
    persistent: true,
  })

  watcher.on('all', () => scheduleRefresh(repoPath))
  activeWatcher = watcher
  return watcher
}

export async function switchRepo(newRepoPath: string): Promise<void> {
  if (activeWatcher) {
    await activeWatcher.close()
    activeWatcher = null
  }
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  latest = { unstaged: '', staged: '', updatedAt: new Date(0).toISOString() }
  await startDiffWatcher(newRepoPath)
}

export function getLatestDiff(): DiffSnapshot {
  return latest
}

export function getRepoPath(): string | null {
  return currentRepoPath
}

export function isInManualMode(): boolean {
  return manualMode
}

export function getManualLabel(): string | null {
  return manualRepoLabel
}

/** Called when the user explicitly loads a public GitHub URL. */
export function setManualDiff(repoLabel: string, diffText: string) {
  manualMode = true
  manualRepoLabel = repoLabel
  currentRepoPath = repoLabel        // used for quiz-result storage key etc.
  latest = {
    unstaged: diffText,
    staged: '',
    updatedAt: new Date().toISOString(),
  }
}

/** Return to watching the local repo. */
export async function exitManualMode() {
  if (!localRepoPath) return
  manualMode = false
  manualRepoLabel = null
  currentRepoPath = localRepoPath
  // Force an immediate refresh of the local diff
  await refresh(localRepoPath)
}

export function triggerRefresh() {
  if (manualMode) return             // never refresh automatically in manual mode
  if (currentRepoPath) void refresh(currentRepoPath)
}
