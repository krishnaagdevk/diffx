import { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type AgentStatus = 'idle' | 'scanning' | 'done'

function AgentRow({ icon, name, status, count }: { icon: string; name: string; status: AgentStatus; count?: number }) {
  const statusText =
    status === 'scanning' ? 'scanning…'
    : status === 'done' ? (count !== undefined ? `✓ ${count} found` : '✓ done')
    : 'waiting'
  return (
    <div className={`agent-row ${status}`}>
      <span className="agent-icon">{icon}</span>
      <span className="agent-name">{name}</span>
      <div className="agent-bar-wrap"><div className="agent-bar" /></div>
      <span className="agent-status-text">{statusText}</span>
    </div>
  )
}
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DiffToolbar } from './components/diff/DiffToolbar'
import { DiffViewer } from './components/diff/DiffViewer'
import { SettingsDrawer } from './components/settings/SettingsDrawer'
import { Sidebar, type FileStatus, type SidebarFile } from './components/sidebar/Sidebar'
import { ImpactMapper } from './components/impact/ImpactMapper'
import { BriefingPlayer } from './components/audio/BriefingPlayer'
import { Dashboard } from './components/dashboard/Dashboard'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import {
  buildExplainInstructions,
  buildQuizRules,
  defaultSettings,
  loadSettings,
  mergeSettings,
  saveSettings,
  type Settings,
} from './utils/settings'
import './App.css'

type FileEntry = SidebarFile & {
  status: FileStatus
  name: string
  prevName?: string
  type: FileDiffMetadata['type']
}
type SelectedFileRef = { path: string; status: FileStatus }

type LatestDiffResponse = {
  diffHash?: string
  staged?: string
  unstaged?: string
}

type FileContentsResponse = {
  oldFile?: { name?: string; contents?: string }
  newFile?: { name?: string; contents?: string }
}

function insertByPath(base: FileEntry[], moved: FileEntry[]): FileEntry[] {
  if (moved.length === 0) return base
  const ordered = [...base]
  const movedSorted = [...moved].sort((a, b) => a.path.localeCompare(b.path))
  movedSorted.forEach((file) => {
    const insertIndex = ordered.findIndex((entry) => entry.path.localeCompare(file.path) > 0)
    if (insertIndex === -1) {
      ordered.push(file)
    } else {
      ordered.splice(insertIndex, 0, file)
    }
  })
  return ordered
}

function parseFileDiffs(patchText: string, status: FileStatus): FileEntry[] {
  if (!patchText.trim()) return []
  const parsed = parsePatchFiles(patchText)
  const parsedFiles = parsed.flatMap((entry) => entry.files ?? [])
  return parsedFiles.map((fileDiff, index) => {
    const additions = fileDiff.hunks.reduce((total, hunk) => total + (hunk.additionLines ?? 0), 0)
    const deletions = fileDiff.hunks.reduce((total, hunk) => total + (hunk.deletionLines ?? 0), 0)
    const path = fileDiff.name || fileDiff.prevName || 'Untitled'
    const key = `${status}:${path}:${index}`
    return {
      key,
      path,
      additions,
      deletions,
      status,
      name: fileDiff.name || path,
      prevName: fileDiff.prevName,
      type: fileDiff.type,
    }
  })
}

function App() {
  const fileDiffCacheRef = useRef(new Map<string, FileDiffMetadata>())
  const parsedDiffHashRef = useRef<string | null>(null)
  const isLoadingRef = useRef(false)
  const [parsedStaged, setParsedStaged] = useState<FileEntry[]>([])
  const [parsedUnstaged, setParsedUnstaged] = useState<FileEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedFileError, setSelectedFileError] = useState<string | null>(null)
  const [selectedFileRef, setSelectedFileRef] = useState<SelectedFileRef | null>(null)
  const [selectedFileDiff, setSelectedFileDiff] = useState<FileDiffMetadata | null>(null)
  const [selectedFileLoading, setSelectedFileLoading] = useState(false)
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('split')
  const [pendingStage, setPendingStage] = useState<Set<string>>(new Set())
  const [pendingUnstage, setPendingUnstage] = useState<Set<string>>(new Set())
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [isManualMode, setIsManualMode] = useState(false)
  const [manualLabel, setManualLabel] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(true)
  const [reviewMode, setReviewMode] = useState<
    'explain' | 'quiz' | 'review' | 'impact' | 'podcast' | 'stats' | 'pr' | 'tests'
  >('explain')
  const [reviewInput, setReviewInput] = useState('')
  const [reviewLog, setReviewLog] = useState<
    { id: number; role: 'user' | 'assistant'; content: string }[]
  >([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  type QuizQuestion = {
    id: string
    prompt: string
    options: string[]
    answerIndex?: number
    explanation?: string
  }
  type QuizResult = {
    id: number
    score: number
    total: number
    answered: number
    completedAt: string
    questions: QuizQuestion[]
    answers: Record<string, number | null>
    diffHash?: string
  }

  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([])
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number | null>>({})
  const [quizLoading, setQuizLoading] = useState(false)
  const [quizError, setQuizError] = useState<string | null>(null)
  const [quizSubmitted, setQuizSubmitted] = useState(false)
  const [quizView, setQuizView] = useState<'quiz' | 'results'>('quiz')
  const [quizResults, setQuizResults] = useState<QuizResult[]>([])
  const [strictMode, setStrictMode] = useState(true)
  const [strictModeNotice, setStrictModeNotice] = useState<string | null>(null)
  const [currentDiffHash, setCurrentDiffHash] = useState<string | null>(null)
  const hasQuizResultForDiff =
    typeof currentDiffHash === 'string' &&
    quizResults.some((result) => result.diffHash === currentDiffHash)

  type ReviewFinding = {
    category: 'bug' | 'security' | 'quality'
    severity: 'critical' | 'warning' | 'suggestion'
    title: string
    description: string
    file?: string
    line?: number
  }
  type CodeReviewResult = {
    summary: string
    findings: ReviewFinding[]
    stats: {
      bugs: number
      security: number
      quality: number
      critical: number
      warnings: number
      suggestions: number
    }
  }
  const [codeReviewResult, setCodeReviewResult] = useState<CodeReviewResult | null>(null)
  const [codeReviewLoading, setCodeReviewLoading] = useState(false)
  const [codeReviewError, setCodeReviewError] = useState<string | null>(null)
  // HITL: tracks which critical findings the human has explicitly acknowledged
  const [acknowledgedFindings, setAcknowledgedFindings] = useState<Set<number>>(new Set())

  // ── New features ──
  const [fileSearch, setFileSearch] = useState('')
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [annotations, setAnnotations] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('diffx-annotations') ?? '{}') } catch { return {} }
  })
  const [prDescription, setPrDescription] = useState<{ title: string; body: string } | null>(null)
  const [prLoading, setPrLoading] = useState(false)
  const [prError, setPrError] = useState<string | null>(null)
  const [testHints, setTestHints] = useState<{ area: string; description: string; priority: string }[]>([])
  const [testHintsLoading, setTestHintsLoading] = useState(false)
  const [testHintsError, setTestHintsError] = useState<string | null>(null)
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([])
  const [branchBase, setBranchBase] = useState('')
  const [branchCompare, setBranchCompare] = useState('')
  const [branchDiff, setBranchDiff] = useState<string | null>(null)
  const [branchDiffLoading, setBranchDiffLoading] = useState(false)
  const [branchDiffError, setBranchDiffError] = useState<string | null>(null)
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null)

  // ── Agent progress (live animation for code review) ──
  const [agentProgress, setAgentProgress] = useState<{ bugHunter: AgentStatus; security: AgentStatus; quality: AgentStatus }>({ bugHunter: 'idle', security: 'idle', quality: 'idle' })
  const agentTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // ── Quiz pass celebration ──
  const [quizJustPassed, setQuizJustPassed] = useState(false)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const handleSettingsChange = useCallback((next: Settings) => {
    setSettings(mergeSettings(next))
  }, [])

  const handleSettingsReset = useCallback(() => {
    setSettings(defaultSettings)
  }, [])

  const hasChanges = parsedStaged.length + parsedUnstaged.length > 0

  const stagedFiles = useMemo(() => {
    const base = parsedStaged.filter((file) => !pendingUnstage.has(file.path))
    const moved = parsedUnstaged
      .filter((file) => pendingStage.has(file.path))
      .map((file) => ({ ...file, key: `staged:${file.path}:pending` }))
    return insertByPath(base, moved).map((file) => ({
      key: file.key,
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
    }))
  }, [parsedStaged, parsedUnstaged, pendingStage, pendingUnstage])

  const unstagedFiles = useMemo(() => {
    const base = parsedUnstaged.filter((file) => !pendingStage.has(file.path))
    const moved = parsedStaged
      .filter((file) => pendingUnstage.has(file.path))
      .map((file) => ({ ...file, key: `unstaged:${file.path}:pending` }))
    return insertByPath(base, moved).map((file) => ({
      key: file.key,
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
    }))
  }, [parsedStaged, parsedUnstaged, pendingStage, pendingUnstage])

  const allFiles = useMemo(() => [...parsedStaged, ...parsedUnstaged], [parsedStaged, parsedUnstaged])

  const selectedFile = useMemo(() => {
    if (!selectedFileRef) return null
    return (
      allFiles.find(
        (file) => file.path === selectedFileRef.path && file.status === selectedFileRef.status
      ) ?? null
    )
  }, [selectedFileRef, allFiles])

  const selectedFilename =
    selectedFileDiff?.name || selectedFileDiff?.prevName || selectedFile?.path || null

  const load = useCallback(async () => {
    if (isLoadingRef.current) return
    isLoadingRef.current = true
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/diffs/latest')
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('API endpoint not found (404). Please ensure VITE_API_URL is configured to point to your Render backend URL, not your Vercel frontend URL.')
        }
        throw new Error(`Failed to load diff (${response.status})`)
      }
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server did not return JSON. Please ensure VITE_API_URL is configured to point to your Render backend URL, not your Vercel frontend URL.')
      }
      const data = (await response.json()) as LatestDiffResponse
      const staged = data.staged ?? ''
      const unstaged = data.unstaged ?? ''
      const nextDiffHash = typeof data.diffHash === 'string' ? data.diffHash : null
      setCurrentDiffHash(nextDiffHash)
      if (nextDiffHash === parsedDiffHashRef.current) {
        return
      }

      parsedDiffHashRef.current = nextDiffHash
      fileDiffCacheRef.current.clear()

      const stagedParsed = parseFileDiffs(staged, 'staged')
      const unstagedParsed = parseFileDiffs(unstaged, 'unstaged')
      setParsedStaged(stagedParsed)
      setParsedUnstaged(unstagedParsed)

      const hasContent = staged.trim() || unstaged.trim()
      const allParsed = [...stagedParsed, ...unstagedParsed]
      const allPaths = new Set(allParsed.map((file) => file.path))

      setPendingStage((prev) => {
        const next = new Set([...prev].filter((path) => allPaths.has(path)))
        return next.size === prev.size ? prev : next
      })
      setPendingUnstage((prev) => {
        const next = new Set([...prev].filter((path) => allPaths.has(path)))
        return next.size === prev.size ? prev : next
      })

      if (hasContent && allParsed.length === 0) {
        setError('Diff loaded but could not be parsed.')
      } else {
        setError(null)
      }

      setSelectedFileRef((prev) => {
        if (allParsed.length === 0) {
          return null
        }
        if (!prev) {
          return { path: allParsed[0].path, status: allParsed[0].status }
        }

        const exactMatch = allParsed.some(
          (file) => file.path === prev.path && file.status === prev.status
        )
        if (exactMatch) return prev

        const samePathFallback = allParsed.find((file) => file.path === prev.path)
        if (samePathFallback) {
          return { path: samePathFallback.path, status: samePathFallback.status }
        }

        return { path: allParsed[0].path, status: allParsed[0].status }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diff')
    } finally {
      isLoadingRef.current = false
    }
  }, [])

  const fetchQuiz = useCallback(async () => {
    setQuizLoading(true)
    setQuizError(null)
    setQuizSubmitted(false)
    try {
      const quizRules = buildQuizRules(settings.quiz)
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/ai/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: settings.quiz.questionCount,
          quizConfig: {
            rules: quizRules,
            includeExplanations: settings.quiz.includeExplanations,
          },
        }),
      })
      if (!response.ok) {
        throw new Error(`Failed to build quiz (${response.status})`)
      }
      const data = (await response.json()) as {
        questions?: {
          id?: string
          prompt?: string
          options?: string[]
          answerIndex?: number
          explanation?: string
        }[]
      }
      const questions =
        data.questions?.filter(
          (question): question is {
            id: string
            prompt: string
            options: string[]
            answerIndex?: number
            explanation?: string
          } =>
            typeof question.id === 'string' &&
            typeof question.prompt === 'string' &&
            Array.isArray(question.options)
        ) ?? []
      setQuizQuestions(questions)
      setQuizAnswers(
        questions.reduce<Record<string, number | null>>((acc, question) => {
          acc[question.id] = null
          return acc
        }, {})
      )
    } catch (error) {
      setQuizError(error instanceof Error ? error.message : 'Failed to load quiz.')
    } finally {
      setQuizLoading(false)
    }
  }, [settings.quiz])

  const loadQuizResults = useCallback(async () => {
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/quiz/results')
      if (!response.ok) return
      const data = (await response.json()) as { results?: QuizResult[] }
      if (Array.isArray(data.results)) {
        setQuizResults(data.results)
      }
    } catch (error) {
      console.error('Failed to load quiz results:', error)
    }
  }, [])

  const fetchCodeReview = useCallback(async () => {
    // Reset and start agent animation
    agentTimersRef.current.forEach(clearTimeout)
    setAgentProgress({ bugHunter: 'idle', security: 'idle', quality: 'idle' })
    setCodeReviewLoading(true)
    setCodeReviewError(null)
    setCodeReviewResult(null)
    setAcknowledgedFindings(new Set()) // reset HITL acknowledgments on new review

    const t1 = setTimeout(() => setAgentProgress(p => ({ ...p, bugHunter: 'scanning' })), 150)
    const t2 = setTimeout(() => setAgentProgress(p => ({ ...p, security: 'scanning' })), 650)
    const t3 = setTimeout(() => setAgentProgress(p => ({ ...p, quality: 'scanning' })), 1100)
    agentTimersRef.current = [t1, t2, t3]

    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/ai/code-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewConfig: {
            enableBugHunter: settings.codeReview.enableBugHunter,
            enableSecurity: settings.codeReview.enableSecurity,
            enableQuality: settings.codeReview.enableQuality,
          },
        }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || `Code review failed (${response.status})`)
      }
      const data = (await response.json()) as CodeReviewResult
      setCodeReviewResult(data)
      setAgentProgress({ bugHunter: 'done', security: 'done', quality: 'done' })
    } catch (error) {
      setCodeReviewError(error instanceof Error ? error.message : 'Code review failed.')
      setAgentProgress({ bugHunter: 'idle', security: 'idle', quality: 'idle' })
    } finally {
      agentTimersRef.current.forEach(clearTimeout)
      setCodeReviewLoading(false)
    }
  }, [settings.codeReview])

  useEffect(() => {
    fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/health')
      .then((res) => {
        if (res.ok) console.log('Successfully pinged backend on startup.')
        else console.error('Backend ping failed on startup:', res.status)
      })
      .catch((err) => console.error('Failed to ping backend on startup:', err))
  }, [])

  useEffect(() => {
    void load()
    const interval = window.setInterval(load, 1000)
    return () => window.clearInterval(interval)
  }, [load])

  useEffect(() => {
    if (!selectedFileRef || !selectedFile) {
      setSelectedFileDiff(null)
      setSelectedFileError(null)
      setSelectedFileLoading(false)
      return
    }

    let active = true
    const controller = new AbortController()
    const params = new URLSearchParams({
      status: selectedFile.status,
      path: selectedFile.path,
      name: selectedFile.name,
      type: selectedFile.type,
    })
    if (selectedFile.prevName) {
      params.set('prevName', selectedFile.prevName)
    }
    const cacheKey = `${currentDiffHash ?? ''}:${selectedFile.status}:${selectedFile.path}:${selectedFile.prevName ?? ''
      }`
    const cachedFileDiff = fileDiffCacheRef.current.get(cacheKey)
    if (cachedFileDiff) {
      setSelectedFileLoading(false)
      setSelectedFileError(null)
      setSelectedFileDiff(cachedFileDiff)
      return
    }

    setSelectedFileLoading(true)
    setSelectedFileError(null)
    setSelectedFileDiff(null)

    void fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/diffs/file-contents?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load file (${response.status})`)
        }
        return (await response.json()) as FileContentsResponse
      })
      .then((data) => {
        const oldFile = data.oldFile
        const newFile = data.newFile
        if (
          typeof oldFile?.name !== 'string' ||
          typeof oldFile.contents !== 'string' ||
          typeof newFile?.name !== 'string' ||
          typeof newFile.contents !== 'string'
        ) {
          throw new Error('Invalid file contents response')
        }

        const parsedDiff = parseDiffFromFile(
          { name: oldFile.name, contents: oldFile.contents },
          { name: newFile.name, contents: newFile.contents }
        )
        const fileDiff: FileDiffMetadata = {
          ...parsedDiff,
          name: newFile.name,
          prevName: selectedFile.prevName ?? parsedDiff.prevName,
          type: selectedFile.type,
        }
        if (!active) return
        const cache = fileDiffCacheRef.current
        cache.set(cacheKey, fileDiff)
        if (cache.size > 60) {
          const evict = [...cache.keys()].slice(0, 15)
          evict.forEach((k) => cache.delete(k))
        }
        setSelectedFileDiff(fileDiff)
      })
      .catch((err) => {
        if (!active) return
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        setSelectedFileDiff(null)
        setSelectedFileError(
          err instanceof Error ? err.message : 'Failed to load selected file diff'
        )
      })
      .finally(() => {
        if (!active) return
        setSelectedFileLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [
    currentDiffHash,
    selectedFileRef,
    selectedFile?.name,
    selectedFile?.path,
    selectedFile?.prevName,
    selectedFile?.status,
    selectedFile?.type,
  ])

  useEffect(() => {
    void loadQuizResults()
  }, [loadQuizResults])

  useEffect(() => {
    let isMounted = true
    fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/repo')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { path?: string; manual?: boolean; manualLabel?: string } | null) => {
        if (!isMounted || !data || typeof data.path !== 'string') return
        setRepoPath(data.path)
        setIsManualMode(Boolean(data.manual))
        setManualLabel(data.manualLabel ?? null)
      })
      .catch(() => null)
    return () => {
      isMounted = false
    }
  }, [])

  const handleStageFile = useCallback((filePath: string) => {
    setPendingStage((prev) => new Set(prev).add(filePath))
    setPendingUnstage((prev) => {
      const next = new Set(prev)
      next.delete(filePath)
      return next
    })
    fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/git/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    })
      .catch((err) => console.error('Failed to stage file:', err))
      .finally(() => {
        setPendingStage((prev) => {
          if (!prev.has(filePath)) return prev
          const next = new Set(prev)
          next.delete(filePath)
          return next
        })
      })
  }, [])

  const handleUnstageFile = useCallback((filePath: string) => {
    setPendingUnstage((prev) => new Set(prev).add(filePath))
    setPendingStage((prev) => {
      const next = new Set(prev)
      next.delete(filePath)
      return next
    })
    fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/git/unstage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    })
      .catch((err) => console.error('Failed to unstage file:', err))
      .finally(() => {
        setPendingUnstage((prev) => {
          if (!prev.has(filePath)) return prev
          const next = new Set(prev)
          next.delete(filePath)
          return next
        })
      })
  }, [])

  const handleCommit = useCallback(
    async (message: string) => {
      if (strictMode && !hasQuizResultForDiff) {
        throw new Error('Complete a quiz before committing.')
      }
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, strictMode }),
      })
      if (!response.ok) {
        let detail = `Failed to commit (${response.status})`
        try {
          const data = (await response.json()) as { error?: string }
          if (typeof data.error === 'string' && data.error.trim()) {
            detail = data.error
          }
        } catch {
          // Ignore JSON parse errors
        }
        throw new Error(detail)
      }
      await load()
    },
    [hasQuizResultForDiff, load, strictMode]
  )

  const handlePush = useCallback(async () => {
    if (strictMode && !hasQuizResultForDiff) {
      throw new Error('Complete a quiz before pushing.')
    }
    const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/git/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strictMode }),
    })
    if (!response.ok) {
      let detail = `Failed to push (${response.status})`
      try {
        const data = (await response.json()) as { error?: string }
        if (typeof data.error === 'string' && data.error.trim()) {
          detail = data.error
        }
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(detail)
    }
  }, [hasQuizResultForDiff, strictMode])

  useEffect(() => {
    if (!strictModeNotice) return
    const timeout = window.setTimeout(() => setStrictModeNotice(null), 2500)
    return () => window.clearTimeout(timeout)
  }, [strictModeNotice])

  const handleStash = useCallback(async () => {
    const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/git/stash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      let detail = `Failed to stash (${response.status})`
      try {
        const data = (await response.json()) as { error?: string }
        if (typeof data.error === 'string' && data.error.trim()) {
          detail = data.error
        }
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(detail)
    }
    await load()
  }, [load])

  const handlePublicRepoLoaded = useCallback(async () => {
    parsedDiffHashRef.current = null
    isLoadingRef.current = false
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/repo')
      if (response.ok) {
        const data = (await response.json()) as { path?: string; manual?: boolean; manualLabel?: string }
        if (typeof data.path === 'string') setRepoPath(data.path)
        setIsManualMode(Boolean(data.manual))
        setManualLabel(data.manualLabel ?? null)
      }
    } catch {}
    await load()
  }, [load])

  // ── Risk score (heuristic, client-side) ──
  const riskScore = useMemo(() => {
    const staged = parsedStaged.reduce((s, f) => s + f.additions + f.deletions, 0)
    const unstaged = parsedUnstaged.reduce((s, f) => s + f.additions + f.deletions, 0)
    const totalLines = staged + unstaged
    const totalFiles = parsedStaged.length + parsedUnstaged.length
    if (totalFiles === 0) return null

    let score = 0
    const reasons: string[] = []

    const fileScore = Math.min(3, totalFiles * 0.4)
    score += fileScore
    if (totalFiles >= 5) reasons.push(`${totalFiles} files changed`)

    const lineScore = Math.min(3, totalLines / 80)
    score += lineScore
    if (totalLines > 80) reasons.push(`${totalLines} lines changed`)

    const allPaths = [...parsedStaged, ...parsedUnstaged].map(f => f.path.toLowerCase())
    const secPaths = allPaths.filter(p => /auth|crypt|password|secret|token|key|cert|credential|oauth|jwt|session/.test(p))
    if (secPaths.length > 0) { score += 2.5; reasons.push('Security-sensitive files') }

    const depPaths = allPaths.filter(p => /package\.json|requirements\.txt|go\.mod|cargo\.toml|pom\.xml|gemfile/.test(p))
    if (depPaths.length > 0) { score += 1.5; reasons.push('Dependency files changed') }

    const cfgPaths = allPaths.filter(p => /\.(env|yaml|yml|toml|ini|conf|cfg)$|dockerfile|docker-compose|terraform/.test(p))
    if (cfgPaths.length > 0) { score += 1; reasons.push('Config files changed') }

    const hasTests = allPaths.some(p => /test|spec|__tests__/.test(p))
    if (!hasTests && totalLines > 30) { score += 1; reasons.push('No test files changed') }

    return { score: Math.max(1, Math.min(10, Math.round(score))), reasons }
  }, [parsedStaged, parsedUnstaged])

  // ── Dependency change detector ──
  const depChanges = useMemo(() => {
    const DEP_FILES = ['package.json', 'requirements.txt', 'go.mod', 'cargo.toml', 'gemfile', 'pom.xml']
    return [...parsedStaged, ...parsedUnstaged].filter(f =>
      DEP_FILES.some(d => f.path.toLowerCase().endsWith(d))
    ).map(f => f.path)
  }, [parsedStaged, parsedUnstaged])

  // ── Save annotations to localStorage ──
  useEffect(() => {
    localStorage.setItem('diffx-annotations', JSON.stringify(annotations))
  }, [annotations])

  const handleAnnotationChange = useCallback((filePath: string, note: string) => {
    setAnnotations(prev => ({ ...prev, [filePath]: note }))
  }, [])

  // ── PR description ──
  const fetchPRDescription = useCallback(async () => {
    setPrLoading(true)
    setPrError(null)
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/ai/pr-description', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || `Failed (${response.status})`)
      }
      const data = (await response.json()) as { title: string; body: string }
      setPrDescription(data)
    } catch (err) {
      setPrError(err instanceof Error ? err.message : 'Failed to generate PR description')
    } finally {
      setPrLoading(false)
    }
  }, [])

  // ── Test hints ──
  const fetchTestHints = useCallback(async () => {
    setTestHintsLoading(true)
    setTestHintsError(null)
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/ai/test-hints', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || `Failed (${response.status})`)
      }
      const data = (await response.json()) as { hints: typeof testHints }
      setTestHints(data.hints)
    } catch (err) {
      setTestHintsError(err instanceof Error ? err.message : 'Failed to generate test hints')
    } finally {
      setTestHintsLoading(false)
    }
  }, [])

  // ── Branch diff ──
  const loadBranches = useCallback(async () => {
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/git/branches')
      if (!response.ok) return
      const data = (await response.json()) as { branches: { name: string; current: boolean }[] }
      setBranches(data.branches)
      const current = data.branches.find(b => b.current)
      if (current) setBranchCompare(current.name)
      const main = data.branches.find(b => b.name === 'main' || b.name === 'master')
      if (main) setBranchBase(main.name)
    } catch {}
  }, [])

  const fetchBranchDiff = useCallback(async () => {
    if (!branchBase || !branchCompare) return
    setBranchDiffLoading(true)
    setBranchDiffError(null)
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/git/branch-diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: branchBase, compare: branchCompare }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || `Failed (${response.status})`)
      }
      const data = (await response.json()) as { diff: string }
      setBranchDiff(data.diff)
    } catch (err) {
      setBranchDiffError(err instanceof Error ? err.message : 'Branch diff failed')
    } finally {
      setBranchDiffLoading(false)
    }
  }, [branchBase, branchCompare])

  // ── Repo switcher ──
  const handleExitManualMode = useCallback(async () => {
    await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/repo/exit-manual', { method: 'POST' })
    setIsManualMode(false)
    setManualLabel(null)
    parsedDiffHashRef.current = null
    isLoadingRef.current = false
    await load()
  }, [load])

  const handleSwitchRepo = useCallback(async (newPath: string) => {
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/repo/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || 'Failed to switch repo')
      }
      setRepoPath(newPath)
      parsedDiffHashRef.current = null
      isLoadingRef.current = false
      await load()
    } catch (err) {
      throw err
    }
  }, [load])

  // ── Keyboard shortcuts ──

  useKeyboardShortcuts({
    onNextFile: () => {
      if (allFiles.length === 0) return
      const idx = allFiles.findIndex(f => f.path === selectedFileRef?.path && f.status === selectedFileRef?.status)
      const next = allFiles[(idx + 1) % allFiles.length]
      setSelectedFileRef({ path: next.path, status: next.status })
    },
    onPrevFile: () => {
      if (allFiles.length === 0) return
      const idx = allFiles.findIndex(f => f.path === selectedFileRef?.path && f.status === selectedFileRef?.status)
      const prev = allFiles[(idx - 1 + allFiles.length) % allFiles.length]
      setSelectedFileRef({ path: prev.path, status: prev.status })
    },
    onStageFile: () => {
      if (selectedFileRef?.status === 'unstaged') handleStageFile(selectedFileRef.path)
    },
    onUnstageFile: () => {
      if (selectedFileRef?.status === 'staged') handleUnstageFile(selectedFileRef.path)
    },
    onFocusCommit: () => commitInputRef.current?.focus(),
    onToggleSearch: () => setFileSearchOpen(prev => !prev),
  })

  const handleReviewSubmit = useCallback(async () => {
    const question = reviewInput.trim()
    if (!question || reviewLoading) return

    setReviewInput('')
    setReviewError(null)
    setReviewLoading(true)
    setReviewLog((prev) => [...prev, { id: Date.now(), role: 'user', content: question }])

    try {
      const instructions = buildExplainInstructions(settings.explain)
      const response = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/ai/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          filePath: selectedFileRef?.path,
          reviewConfig: {
            scopePreference: settings.explain.scopePreference,
            instructions,
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`AI request failed (${response.status})`)
      }

      const data = (await response.json()) as { answer?: string }
      const answer = data.answer ?? 'No response.'
      setReviewLog((prev) => [...prev, { id: Date.now() + 1, role: 'assistant', content: answer }])
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'AI request failed')
    } finally {
      setReviewLoading(false)
    }
  }, [reviewInput, reviewLoading, selectedFileRef, settings.explain])

  const handleQuizSelect = useCallback((questionId: string, optionIndex: number) => {
    setQuizAnswers((prev) => ({ ...prev, [questionId]: optionIndex }))
  }, [])

  const handleQuizSubmit = useCallback(() => {
    const total = quizQuestions.length
    const answered = Object.values(quizAnswers).filter((value) => value != null).length
    const score = quizQuestions.reduce((sum, question) => {
      const answer = quizAnswers[question.id]
      if (answer == null) return sum
      if (question.answerIndex == null) return sum
      return sum + (answer === question.answerIndex ? 1 : 0)
    }, 0)
    const completedAt = new Date().toLocaleString()
    const result = {
      id: Date.now(),
      score,
      total,
      answered,
      completedAt,
      questions: quizQuestions,
      answers: quizAnswers,
      diffHash: currentDiffHash ?? undefined,
    }
    setQuizResults((prev) => [result, ...prev])
    fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/quiz/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    })
      .then(async (response) => {
        if (!response.ok) return
        const data = (await response.json()) as { result?: QuizResult }
        const savedResult = data.result
        if (!savedResult) return
        setQuizResults((prev) => {
          const next = [...prev]
          const index = next.findIndex((item) => item.id === savedResult.id)
          if (index === -1) {
            return [savedResult, ...prev]
          }
          next[index] = savedResult
          return next
        })
      })
      .catch((error) => console.error('Failed to save quiz result:', error))
    setQuizSubmitted(true)
    setQuizView('results')
    // Celebrate if they pass (≥50%)
    if (score / Math.max(total, 1) >= 0.5) {
      setQuizJustPassed(true)
      setTimeout(() => setQuizJustPassed(false), 1400)
    }
  }, [currentDiffHash, quizAnswers, quizQuestions])

  return (
    <div className="app">
      <Sidebar
        stagedFiles={stagedFiles}
        unstagedFiles={unstagedFiles}
        selectedFile={selectedFileRef}
        repoPath={repoPath}
        hasQuizResult={hasQuizResultForDiff}
        strictMode={strictMode}
        strictModeNotice={strictModeNotice}
        onToggleStrictMode={() => {
          setStrictMode((prev) => {
            const next = !prev
            if (next) {
              setStrictModeNotice('Pre-commit quiz must be completed.')
            }
            return next
          })
        }}
        commitMessageSettings={settings.commitMessage}
        onSelectFile={(selection) => setSelectedFileRef(selection)}
        onStageFile={handleStageFile}
        onUnstageFile={handleUnstageFile}
        onCommit={handleCommit}
        onPush={handlePush}
        onStash={handleStash}
        onPublicRepoLoaded={handlePublicRepoLoaded}
        onSwitchRepo={handleSwitchRepo}
        isManualMode={isManualMode}
        manualLabel={manualLabel}
        onExitManualMode={handleExitManualMode}
        onFetchPRDescription={fetchPRDescription}
        prDescription={prDescription}
        prLoading={prLoading}
        prError={prError}
        annotations={annotations}
        onAnnotationChange={handleAnnotationChange}
        branches={branches}
        branchBase={branchBase}
        branchCompare={branchCompare}
        onBranchBaseChange={setBranchBase}
        onBranchCompareChange={setBranchCompare}
        onFetchBranchDiff={fetchBranchDiff}
        onLoadBranches={loadBranches}
        branchDiff={branchDiff}
        branchDiffLoading={branchDiffLoading}
        branchDiffError={branchDiffError}
        commitInputRef={commitInputRef}
        fileSearch={fileSearch}
        fileSearchOpen={fileSearchOpen}
        onFileSearchChange={setFileSearch}
        onFileSearchToggle={() => setFileSearchOpen(prev => !prev)}
        onFileSearchClose={() => { setFileSearch(''); setFileSearchOpen(false) }}
        riskScore={riskScore}
        depChanges={depChanges}
      />
      <main className="main">
        <div className={`workspace ${reviewOpen ? 'review-open' : 'review-closed'}`}>
          <section className="diff-panel">
            <DiffToolbar
              fileName={selectedFilename}
              diffMode={diffMode}
              onDiffModeChange={setDiffMode}
              hasSelection={selectedFile != null}
            />
            {riskScore && (
              <div
                className={`risk-bar risk-${riskScore.score <= 3 ? 'low' : riskScore.score <= 6 ? 'med' : 'high'}`}
                title="Click to run code review"
                onClick={() => { setReviewMode('review'); setReviewOpen(true) }}
              >
                <span className="risk-label">Risk</span>
                <span className="risk-score">{riskScore.score}/10</span>
                <span className="risk-reasons">{riskScore.reasons.join(' · ')}</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', opacity: 0.5 }}>▶ review</span>
              </div>
            )}
            {depChanges.length > 0 && (
              <div className="dep-alert">
                📦 Dependency files changed: {depChanges.join(', ')}
              </div>
            )}
            <div className="main-content">
              <DiffViewer
                error={selectedFileError ?? error}
                hasChanges={hasChanges}
                loading={selectedFileLoading}
                selectedFile={selectedFileDiff}
                diffMode={diffMode}
              />
            </div>
          </section>
          <aside className="review-drawer" aria-label="Review panel">
            <section className="review-panel" aria-hidden={!reviewOpen}>
              <div className="review-header">
                <span>
                  {{
                    explain: '💬 Ask AI',
                    quiz: '🧠 Quiz',
                    review: '🔍 Code Review',
                    impact: '🗺 Impact Map',
                    podcast: '🎙 Briefing',
                    stats: '📊 My Stats',
                    pr: '📋 PR Description',
                    tests: '✅ Test Hints',
                  }[reviewMode]}
                </span>
                <div className="review-header-actions">
                  <button
                    type="button"
                    className="review-clear"
                    onClick={() => {
                      setReviewLog([])
                      setReviewError(null)
                      setReviewInput('')
                      setQuizQuestions([])
                      setQuizAnswers({})
                      setQuizError(null)
                      setQuizSubmitted(false)
                      setQuizResults([])
                      setQuizView('quiz')
                      setCodeReviewResult(null)
                      setCodeReviewError(null)
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="review-settings"
                    aria-label="Open settings"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M10.6 2.1h2.8l.5 2.2a7.7 7.7 0 0 1 1.9.8l2-1.2 2 2-1.2 2a7.7 7.7 0 0 1 .8 1.9l2.2.5v2.8l-2.2.5a7.7 7.7 0 0 1-.8 1.9l1.2 2-2 2-2-1.2a7.7 7.7 0 0 1-1.9.8l-.5 2.2h-2.8l-.5-2.2a7.7 7.7 0 0 1-1.9-.8l-2 1.2-2-2 1.2-2a7.7 7.7 0 0 1-.8-1.9L2 13.4v-2.8l2.2-.5a7.7 7.7 0 0 1 .8-1.9l-1.2-2 2-2 2 1.2a7.7 7.7 0 0 1 1.9-.8l.5-2.2Zm1.4 6.4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="review-tabs" role="tablist" aria-label="Review modes">
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewMode === 'explain'}
                  className={reviewMode === 'explain' ? 'active' : undefined}
                  onClick={() => setReviewMode('explain')}
                >
                  Explain
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewMode === 'quiz'}
                  className={reviewMode === 'quiz' ? 'active' : undefined}
                  onClick={() => setReviewMode('quiz')}
                >
                  Quiz
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewMode === 'review'}
                  className={reviewMode === 'review' ? 'active' : undefined}
                  onClick={() => setReviewMode('review')}
                >
                  Review
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewMode === 'impact'}
                  className={reviewMode === 'impact' ? 'active' : undefined}
                  onClick={() => setReviewMode('impact')}
                >
                  Impact
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewMode === 'podcast'}
                  className={reviewMode === 'podcast' ? 'active' : undefined}
                  onClick={() => setReviewMode('podcast')}
                >
                  Podcast
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewMode === 'stats'}
                  className={reviewMode === 'stats' ? 'active' : undefined}
                  onClick={() => setReviewMode('stats')}
                >
                  Stats
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewMode === 'pr'}
                  className={reviewMode === 'pr' ? 'active' : undefined}
                  onClick={() => setReviewMode('pr')}
                >
                  PR
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={reviewMode === 'tests'}
                  className={reviewMode === 'tests' ? 'active' : undefined}
                  onClick={() => setReviewMode('tests')}
                >
                  Tests
                </button>
              </div>
              <div className="review-body">
                {reviewMode === 'explain' && (
                  <div className="review-log">
                    {reviewLog.length === 0 ? (
                      <p>Ask questions about the current diff or the whole commit.</p>
                    ) : (
                      reviewLog.map((entry) => (
                        <div key={entry.id} className={`review-msg ${entry.role}`}>
                          <span>{entry.role === 'user' ? 'You' : 'DiffX'}</span>
                          <div className="review-markdown">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content}</ReactMarkdown>
                          </div>
                        </div>
                      ))
                    )}
                    {reviewLoading && <p className="review-status">Thinking…</p>}
                    {reviewError && <p className="review-error">{reviewError}</p>}
                  </div>
                )}
                {reviewMode === 'quiz' && (
                  <div className={`quiz-panel${quizJustPassed ? ' just-passed' : ''}`}>
                    {quizView === 'results' ? (
                      <div className="quiz-results">
                        <div className="quiz-results-header">
                          <span>Results</span>
                          <span>{quizResults.length} attempt(s)</span>
                        </div>
                        {quizResults.length === 0 ? (
                          <p>No results yet. Take a quiz first.</p>
                        ) : (
                          <div className="quiz-results-list">
                            {quizResults.map((result, resultIndex) => (
                              <details key={result.id} className="quiz-result-card">
                                <summary>
                                  <span>
                                    Attempt {quizResults.length - resultIndex} • {result.completedAt}
                                  </span>
                                  <span>
                                    Score {result.score}/{result.total} ({result.answered} attempted)
                                  </span>
                                </summary>
                                <div className="quiz-result-questions">
                                  {result.questions.map((question, index) => {
                                    const chosen = result.answers[question.id]
                                    return (
                                      <div key={question.id} className="quiz-result-question">
                                        <div className="quiz-question">
                                          <span className="quiz-index">Q{index + 1}</span>
                                          <p>{question.prompt}</p>
                                        </div>
                                        <div className="quiz-options">
                                          {question.options.map((option, optionIndex) => {
                                            const isSelected = chosen === optionIndex
                                            const isCorrect = question.answerIndex === optionIndex
                                            return (
                                              <div
                                                key={`${question.id}:${optionIndex}`}
                                                className={`quiz-option-result${isSelected ? ' selected' : ''}${isCorrect ? ' correct' : ''
                                                  }`}
                                              >
                                                <span>{option}</span>
                                              </div>
                                            )
                                          })}
                                        </div>
                                        {question.explanation ? (
                                          <p className="quiz-explanation">{question.explanation}</p>
                                        ) : null}
                                      </div>
                                    )
                                  })}
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {quizLoading && <p className="review-status">Generating quiz…</p>}
                        {quizError && <p className="review-error">{quizError}</p>}
                        {!quizLoading && !quizError && quizQuestions.length > 0 && (
                          <div className="quiz-list">
                            {quizQuestions.map((question, index) => (
                              <div key={question.id} className="quiz-card">
                                <div className="quiz-question">
                                  <span className="quiz-index">Q{index + 1}</span>
                                  <p>{question.prompt}</p>
                                </div>
                                <div className="quiz-options">
                                  {question.options.map((option, optionIndex) => (
                                    <button
                                      key={`${question.id}:${optionIndex}`}
                                      type="button"
                                      className={
                                        quizAnswers[question.id] === optionIndex ? 'selected' : undefined
                                      }
                                      onClick={() => handleQuizSelect(question.id, optionIndex)}
                                    >
                                      {option}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                {reviewMode === 'review' && (
                  <div className="review-code-panel">
                    {/* Live agent progress — shown during scan and after */}
                    {agentProgress.bugHunter !== 'idle' && (
                      <div className="agent-rows">
                        <AgentRow icon="🔍" name="Bug Hunter" status={agentProgress.bugHunter} count={codeReviewResult?.stats.bugs} />
                        <AgentRow icon="🔒" name="Security" status={agentProgress.security} count={codeReviewResult?.stats.security} />
                        <AgentRow icon="✨" name="Quality" status={agentProgress.quality} count={codeReviewResult?.stats.quality} />
                      </div>
                    )}
                    {codeReviewError && <p className="review-error">{codeReviewError}</p>}
                    {agentProgress.bugHunter === 'idle' && !codeReviewResult && !codeReviewError && (
                      <p className="review-code-placeholder">
                        Run AI-powered code review to analyze your changes for bugs, security issues, and code quality.
                      </p>
                    )}
                    {codeReviewResult && (
                      <div className="code-review-results">
                        <div className="code-review-header">
                          <div className="code-review-title">Code Review</div>
                          <div className="code-review-stats">
                            <span className="stat-bugs" title="Bugs">
                              Bugs: {codeReviewResult.stats.bugs}
                            </span>
                            <span className="stat-security" title="Security">
                              Security: {codeReviewResult.stats.security}
                            </span>
                            <span className="stat-quality" title="Quality">
                              Quality: {codeReviewResult.stats.quality}
                            </span>
                            <span className="stat-critical" title="Critical">
                              Critical: {codeReviewResult.stats.critical}
                            </span>
                            <span className="stat-warnings" title="Warnings">
                              Warnings: {codeReviewResult.stats.warnings}
                            </span>
                            <span className="stat-suggestions" title="Suggestions">
                              Suggestions: {codeReviewResult.stats.suggestions}
                            </span>
                          </div>
                          <div className="code-review-summary">
                            <p>{codeReviewResult.summary}</p>
                          </div>
                        </div>
                        {codeReviewResult.findings.length > 0 && (
                          <div className="code-review-findings">
                            {codeReviewResult.findings.map((finding, index) => (
                              <details
                                key={index}
                                className={`code-review-accordion severity-${finding.severity}`}
                              >
                                <summary className="finding-summary">
                                  {/* HITL: checkbox to acknowledge critical findings before commit is allowed */}
                                  {finding.severity === 'critical' && (
                                    <input
                                      type="checkbox"
                                      className="finding-ack-checkbox"
                                      checked={acknowledgedFindings.has(index)}
                                      title="Acknowledge this critical finding to unlock commit"
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => {
                                        setAcknowledgedFindings(prev => {
                                          const next = new Set(prev)
                                          if (e.target.checked) next.add(index)
                                          else next.delete(index)
                                          return next
                                        })
                                      }}
                                    />
                                  )}
                                  <span className="finding-badges">
                                    <span className={`finding-badge category-${finding.category}`}>
                                      {finding.category}
                                    </span>
                                    <span className={`finding-badge severity-${finding.severity}`}>
                                      {finding.severity}
                                    </span>
                                  </span>
                                </summary>
                                <div className="finding-body">
                                  <div className="finding-title">{finding.title}</div>
                                  <div className="finding-description">{finding.description}</div>
                                  {finding.file && (
                                    <div className="finding-location">
                                      📄 {finding.file}
                                      {finding.line && `:${finding.line}`}
                                    </div>
                                  )}
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {reviewMode === 'impact' && (
                  <ImpactMapper hasChanges={hasChanges} triggerReloadKey={quizResults.length} />
                )}
                {reviewMode === 'podcast' && (
                  <BriefingPlayer hasChanges={hasChanges} triggerReloadKey={quizResults.length} />
                )}
                {reviewMode === 'stats' && (
                  <Dashboard triggerReloadKey={quizResults.length} />
                )}
                {reviewMode === 'pr' && (
                  <div className="pr-panel">
                    {prError && <p className="review-error">{prError}</p>}
                    {prLoading && <p className="review-status">Generating PR description…</p>}
                    {prDescription && !prLoading && (
                      <div className="pr-result">
                        <div className="pr-title-row">
                          <strong>Title</strong>
                          <button
                            type="button"
                            className="pr-copy-btn"
                            onClick={() => navigator.clipboard.writeText(`# ${prDescription.title}\n\n${prDescription.body}`)}
                          >
                            Copy all
                          </button>
                        </div>
                        <div className="pr-title-box">{prDescription.title}</div>
                        <strong>Body</strong>
                        <div className="pr-body-box review-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{prDescription.body}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                    {!prDescription && !prLoading && !prError && (
                      <p>Generate a GitHub PR description from the current diff.</p>
                    )}
                  </div>
                )}
                {reviewMode === 'tests' && (
                  <div className="tests-panel">
                    {testHintsError && <p className="review-error">{testHintsError}</p>}
                    {testHintsLoading && <p className="review-status">Analyzing test coverage…</p>}
                    {testHints.length > 0 && !testHintsLoading && (
                      <div className="test-hints-list">
                        {testHints.map((h, i) => (
                          <div key={i} className={`test-hint priority-${h.priority}`}>
                            <div className="test-hint-header">
                              <span className="test-hint-area">{h.area}</span>
                              <span className={`test-hint-badge badge-${h.priority}`}>{h.priority}</span>
                            </div>
                            <p className="test-hint-desc">{h.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {testHints.length === 0 && !testHintsLoading && !testHintsError && (
                      <p>Get AI suggestions for what tests to write or update based on the diff.</p>
                    )}
                  </div>
                )}
              </div>
              {reviewMode === 'review' && (
                <div className="code-review-generate-row">
                  <button
                    type="button"
                    onClick={fetchCodeReview}
                    disabled={codeReviewLoading || !hasChanges}
                  >
                    {codeReviewLoading ? 'Reviewing...' : 'Generate Review'}
                  </button>
                </div>
              )}
              {reviewMode === 'pr' && (
                <div className="code-review-generate-row">
                  <button type="button" onClick={fetchPRDescription} disabled={prLoading || !hasChanges}>
                    {prLoading ? 'Generating…' : 'Generate PR Description'}
                  </button>
                </div>
              )}
              {reviewMode === 'tests' && (
                <div className="code-review-generate-row">
                  <button type="button" onClick={fetchTestHints} disabled={testHintsLoading || !hasChanges}>
                    {testHintsLoading ? 'Analyzing…' : 'Suggest Tests'}
                  </button>
                </div>
              )}
              {reviewMode === 'quiz' && (
                <>
                  {quizView === 'quiz' && (
                    <div className="quiz-generate-row">
                      <button type="button" onClick={fetchQuiz} disabled={quizLoading}>
                        Generate quiz
                      </button>
                      <button type="button" onClick={() => setQuizView('results')}>
                        Past results
                      </button>
                    </div>
                  )}
                  {quizView === 'results' && (
                    <div className="quiz-generate-row">
                      <button type="button" onClick={fetchQuiz} disabled={quizLoading}>
                        Generate quiz
                      </button>
                      <button type="button" onClick={() => setQuizView('quiz')}>
                        Back to quiz
                      </button>
                    </div>
                  )}
                  <div className="review-footer">
                    <span>
                      Attempted {Object.values(quizAnswers).filter((value) => value != null).length}/
                      {quizQuestions.length}
                    </span>
                    <div className="quiz-footer-actions">
                      <button
                        type="button"
                        onClick={handleQuizSubmit}
                        disabled={quizQuestions.length === 0}
                      >
                        {quizSubmitted ? 'Submitted' : 'Submit'}
                      </button>
                    </div>
                  </div>
                </>
              )}
              {reviewMode === 'explain' && (
                <div className="review-chat">
                  <input
                    type="text"
                    placeholder="Ask about these changes"
                    aria-label="Ask about these changes"
                    value={reviewInput}
                    onChange={(event) => setReviewInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void handleReviewSubmit()
                      }
                    }}
                  />
                  <button type="button" onClick={() => void handleReviewSubmit()}>
                    Send
                  </button>
                </div>
              )}
            </section>
            <button
              type="button"
              className="review-rail"
              aria-label={reviewOpen ? 'Collapse AI panel' : 'Expand AI panel'}
              onClick={() => setReviewOpen((open) => !open)}
            >
              {reviewOpen ? '▶ Hide' : '◀ AI'}
            </button>
          </aside>
        </div>
      </main>
      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={handleSettingsChange}
        onReset={handleSettingsReset}
      />
    </div>
  )
}

export default App
