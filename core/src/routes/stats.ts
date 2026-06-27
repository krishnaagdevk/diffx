import { Router } from 'express'
import { getRepoPath } from '../services/diffs/watcher'
import { readQuizResults } from '../services/quizResults'

export const statsRouter = Router()

statsRouter.get('/stats/leaderboard', async (req, res) => {
  const repoPath = getRepoPath()
  const results = repoPath ? await readQuizResults(repoPath).catch(() => []) : []

  if (results.length === 0) {
    return res.json({
      totalQuizzes: 0,
      avgAccuracy: 0,
      bestScore: 0,
      currentStreak: 0,
      cognitiveGateBlocks: 0,
      quizHistory: [],
    })
  }

  const sorted = [...results].sort((a, b) => a.id - b.id)

  // streak = consecutive passing quizzes (≥ 50%) from the most recent backwards
  let streak = 0
  for (let i = sorted.length - 1; i >= 0; i--) {
    const { score, total } = sorted[i]
    if (total > 0 && score / total >= 0.5) streak++
    else break
  }

  const pcts = sorted.map(r => (r.total > 0 ? Math.round((r.score / r.total) * 100) : 0))
  const avgAccuracy = Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length)
  const bestScore = Math.max(...pcts)
  const cognitiveGateBlocks = results.filter(r => r.diffHash).length

  const quizHistory = sorted.slice(-12).map(r => ({
    date: r.completedAt.slice(0, 10),
    pct: r.total > 0 ? Math.round((r.score / r.total) * 100) : 0,
    score: r.score,
    total: r.total,
  }))

  res.json({
    totalQuizzes: results.length,
    avgAccuracy,
    bestScore,
    currentStreak: streak,
    cognitiveGateBlocks,
    quizHistory,
  })
})
