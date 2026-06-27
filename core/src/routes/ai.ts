import { Router } from 'express'

import { env } from '../config/env'
import { getLatestDiff, getRepoPath, setManualDiff } from '../services/diffs/watcher'
import { buildCombinedDiff, extractFileDiff } from '../services/ai/diffContext'
import { buildQuiz } from '../services/ai/quiz'
import { answerQuestion, decideScope } from '../services/ai/review'
import { generateCommitMessage, type CommitMessageStyle } from '../services/ai/commitMessage'
import { runCodeReview } from '../services/ai/codeReview'
import { appendQuizResult, computeDiffHash, readQuizResults } from '../services/quizResults'
import { fetchDiffFromUrl } from '../services/git/gitHubClient'
import { generatePRDescription } from '../services/ai/prDescription'
import { generateTestHints } from '../services/ai/testHints'

export const aiRouter = Router()

aiRouter.post('/ai/public-repo', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
  if (!url) {
    res.status(400).json({ error: 'GitHub PR or Commit URL is required.' })
    return
  }

  try {
    const { diff, repoName } = await fetchDiffFromUrl(url)
    setManualDiff(repoName, diff)
    res.json({
      success: true,
      repoName,
      diffLength: diff.length,
    })
  } catch (error: any) {
    console.error('Failed to load public repository diff:', error)
    res.status(500).json({ error: error.message || 'Failed to load public repository diff.' })
  }
})


aiRouter.post('/ai/review', async (req, res) => {
  if (!env.claudeApiKey && !env.groqApiKey && !env.geminiApiKey && !env.openaiApiKey) {
    res.status(503).json({ error: 'No AI API key configured (CLAUDE_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY)' })
    return
  }

  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
  const filePath = typeof req.body?.filePath === 'string' ? req.body.filePath.trim() : null
  const reviewConfig = req.body?.reviewConfig
  const scopePreference =
    typeof reviewConfig?.scopePreference === 'string' ? reviewConfig.scopePreference : null
  const styleInstructions =
    typeof reviewConfig?.instructions === 'string' ? reviewConfig.instructions.trim() : null

  if (!question) {
    res.status(400).json({ error: 'Question is required' })
    return
  }

  const repoPath = getRepoPath()
  const latest = getLatestDiff()
  const fullDiff = buildCombinedDiff(latest)
  const fileDiff = filePath ? extractFileDiff(`${latest.unstaged}\n${latest.staged}`, filePath) : null

  try {
    const decision =
      scopePreference === 'file' || scopePreference === 'repo'
        ? { scope: scopePreference, reason: 'User preference' }
        : await decideScope(question)
    const answer = await answerQuestion({
      question,
      scope: decision.scope,
      repoPath,
      filePath,
      fileDiff,
      fullDiff,
      styleInstructions,
    })

    res.json({
      scope: decision.scope,
      reason: decision.reason ?? null,
      answer,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI review failed'
    console.error('AI review failed:', error)
    res.status(500).json({ error: message })
  }
})

aiRouter.post('/ai/quiz', async (req, res) => {
  if (!env.claudeApiKey && !env.groqApiKey && !env.geminiApiKey && !env.openaiApiKey) {
    res.status(503).json({ error: 'No AI API key configured (CLAUDE_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY)' })
    return
  }

  const count = Number(req.body?.count)
  const questionCount = Number.isFinite(count) && count > 0 && count <= 10 ? Math.floor(count) : 5
  const quizConfig = req.body?.quizConfig
  const rules = typeof quizConfig?.rules === 'string' ? quizConfig.rules.trim() : null
  const includeExplanations =
    typeof quizConfig?.includeExplanations === 'boolean' ? quizConfig.includeExplanations : undefined
  const repoPath = getRepoPath()
  const latest = getLatestDiff()
  const fullDiff = buildCombinedDiff(latest)

  try {
    const quiz = await buildQuiz({ repoPath, fullDiff, questionCount, rules, includeExplanations })
    res.json(quiz)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI quiz failed'
    console.error('AI quiz failed:', error)
    res.status(500).json({ error: message })
  }
})

aiRouter.post('/ai/commit-message', async (req, res) => {
  if (!env.claudeApiKey && !env.groqApiKey && !env.geminiApiKey && !env.openaiApiKey) {
    res.status(503).json({ error: 'No AI API key configured (CLAUDE_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY)' })
    return
  }

  const commitConfig = req.body?.commitConfig
  const followPreviousStyle =
    typeof commitConfig?.followPreviousStyle === 'boolean' ? commitConfig.followPreviousStyle : true
  const style: CommitMessageStyle =
    commitConfig?.style === 'conventional' ||
    commitConfig?.style === 'descriptive' ||
    commitConfig?.style === 'simple'
      ? commitConfig.style
      : 'conventional'
  const includeBody = typeof commitConfig?.includeBody === 'boolean' ? commitConfig.includeBody : true
  const customRules = typeof commitConfig?.customRules === 'string' ? commitConfig.customRules.trim() : null

  const repoPath = getRepoPath()
  const latest = getLatestDiff()
  const fullDiff = buildCombinedDiff(latest)

  if (!fullDiff.trim()) {
    res.status(400).json({ error: 'No changes to generate commit message for' })
    return
  }

  try {
    const result = await generateCommitMessage({
      repoPath,
      fullDiff,
      followPreviousStyle,
      style,
      includeBody,
      customRules,
    })
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI commit message generation failed'
    console.error('AI commit message generation failed:', error)
    res.status(500).json({ error: message })
  }
})

aiRouter.post('/ai/code-review', async (req, res) => {
  if (!env.claudeApiKey && !env.groqApiKey && !env.geminiApiKey && !env.openaiApiKey) {
    res.status(503).json({ error: 'No AI API key configured (CLAUDE_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY)' })
    return
  }

  const reviewConfig = req.body?.reviewConfig
  const enableBugHunter = reviewConfig?.enableBugHunter !== false
  const enableSecurity = reviewConfig?.enableSecurity !== false
  const enableQuality = reviewConfig?.enableQuality !== false

  const repoPath = getRepoPath()
  const latest = getLatestDiff()
  const fullDiff = buildCombinedDiff(latest)

  if (!fullDiff.trim()) {
    res.status(400).json({ error: 'No changes to review' })
    return
  }

  try {
    const result = await runCodeReview({
      repoPath,
      fullDiff,
      enableBugHunter,
      enableSecurity,
      enableQuality,
    })
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI code review failed'
    console.error('AI code review failed:', error)
    res.status(500).json({ error: message })
  }
})

aiRouter.post('/ai/architecture-impact', async (req, res) => {
  if (!env.claudeApiKey && !env.groqApiKey && !env.geminiApiKey && !env.openaiApiKey) {
    res.status(503).json({ error: 'No AI API key configured (CLAUDE_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY)' })
    return
  }

  const repoPath = getRepoPath()
  const latest = getLatestDiff()
  const fullDiff = buildCombinedDiff(latest)

  if (!fullDiff.trim()) {
    res.status(400).json({ error: 'No changes to analyze' })
    return
  }

  try {
    const { analyzeArchitectureImpact } = await import('../services/ai/architectureImpact')
    const result = await analyzeArchitectureImpact(fullDiff, repoPath)
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI architecture impact failed'
    console.error('AI architecture impact failed:', error)
    res.status(500).json({ error: message })
  }
})

aiRouter.get('/quiz/results', async (req, res) => {
  const repoPath = getRepoPath()
  if (!repoPath) {
    res.status(400).json({ error: 'Repository not selected' })
    return
  }

  try {
    const results = await readQuizResults(repoPath)
    res.json({ results })
  } catch (error) {
    console.error('Failed to read quiz results:', error)
    res.status(500).json({ error: 'Failed to read quiz results' })
  }
})

aiRouter.post('/quiz/results', async (req, res) => {
  const repoPath = getRepoPath()
  if (!repoPath) {
    res.status(400).json({ error: 'Repository not selected' })
    return
  }

  const payload = req.body?.result
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'Result payload is required' })
    return
  }

  try {
    const latest = getLatestDiff()
    const fullDiff = buildCombinedDiff(latest)
    const diffHash = computeDiffHash(fullDiff)
    const stored = await appendQuizResult(repoPath, { ...payload, diffHash })
    res.json({ result: stored })
  } catch (error) {
    console.error('Failed to save quiz result:', error)
    res.status(500).json({ error: 'Failed to save quiz result' })
  }
})

aiRouter.post('/ai/pr-description', async (req, res) => {
  if (!env.claudeApiKey && !env.groqApiKey && !env.geminiApiKey && !env.openaiApiKey) {
    res.status(503).json({ error: 'No AI API key configured' })
    return
  }

  const repoPath = getRepoPath()
  const latest = getLatestDiff()
  const fullDiff = buildCombinedDiff(latest)

  if (!fullDiff.trim()) {
    res.status(400).json({ error: 'No changes to generate PR description for' })
    return
  }

  try {
    const result = await generatePRDescription(fullDiff, repoPath)
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PR description generation failed'
    console.error('PR description failed:', error)
    res.status(500).json({ error: message })
  }
})

aiRouter.post('/ai/test-hints', async (req, res) => {
  if (!env.claudeApiKey && !env.groqApiKey && !env.geminiApiKey && !env.openaiApiKey) {
    res.status(503).json({ error: 'No AI API key configured' })
    return
  }

  const repoPath = getRepoPath()
  const latest = getLatestDiff()
  const fullDiff = buildCombinedDiff(latest)

  if (!fullDiff.trim()) {
    res.status(400).json({ error: 'No changes to analyze' })
    return
  }

  try {
    const hints = await generateTestHints(fullDiff, repoPath)
    res.json({ hints })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Test hints generation failed'
    console.error('Test hints failed:', error)
    res.status(500).json({ error: message })
  }
})
