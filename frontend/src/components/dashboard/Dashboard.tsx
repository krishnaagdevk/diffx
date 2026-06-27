import { useEffect, useState } from 'react'
import './Dashboard.css'

type QuizHistoryItem = {
  date: string
  pct: number
  score: number
  total: number
}

type StatsPayload = {
  totalQuizzes: number
  avgAccuracy: number
  bestScore: number
  currentStreak: number
  cognitiveGateBlocks: number
  quizHistory: QuizHistoryItem[]
}

type DashboardProps = {
  triggerReloadKey?: number
}

function QuizChart({ history }: { history: QuizHistoryItem[] }) {
  return (
    <div className="quiz-chart">
      {history.map((h, i) => {
        const color = h.pct >= 80 ? '#00e676' : h.pct >= 50 ? '#ffa726' : '#ff5252'
        return (
          <div
            key={i}
            className="quiz-chart-bar-wrap"
            title={`${h.date}: ${h.score}/${h.total} (${h.pct}%)`}
          >
            <span className="quiz-chart-pct">{h.pct}%</span>
            <div
              className="quiz-chart-bar"
              style={{ height: `${Math.max(4, h.pct)}%`, background: color }}
            />
          </div>
        )
      })}
    </div>
  )
}

export function Dashboard({ triggerReloadKey }: DashboardProps) {
  const [data, setData] = useState<StatsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/stats/leaderboard')
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load stats (${res.status})`)
        return res.json() as Promise<StatsPayload>
      })
      .then(payload => { if (active) setData(payload) })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Failed to load') })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [triggerReloadKey])

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="dashboard-spinner" />
        <p>Loading your stats…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <span>⚠️</span>
        <p>{error}</p>
      </div>
    )
  }

  if (!data) return null

  const hasData = data.totalQuizzes > 0

  if (!hasData) {
    return (
      <div className="dashboard-empty">
        <div className="dashboard-empty-icon">🎯</div>
        <h3>No quiz data yet</h3>
        <p>Take a quiz on a diff to start tracking your comprehension score and streak.</p>
      </div>
    )
  }

  const streakColor = data.currentStreak >= 5 ? '#00e676' : data.currentStreak >= 2 ? '#ffa726' : 'var(--text-muted)'
  const accuracyColor = data.avgAccuracy >= 80 ? '#00e676' : data.avgAccuracy >= 50 ? '#ffa726' : '#ff5252'

  return (
    <div className="dashboard-panel">

      {/* Metric row */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-icon">🎯</span>
          <span className="stat-value" style={{ color: accuracyColor }}>{data.avgAccuracy}%</span>
          <span className="stat-label">Avg Accuracy</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">⭐</span>
          <span className="stat-value">{data.bestScore}%</span>
          <span className="stat-label">Best Score</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">🔥</span>
          <span className="stat-value" style={{ color: streakColor }}>{data.currentStreak}</span>
          <span className="stat-label">Current Streak</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">📋</span>
          <span className="stat-value">{data.totalQuizzes}</span>
          <span className="stat-label">Quizzes Taken</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">🛡️</span>
          <span className="stat-value">{data.cognitiveGateBlocks}</span>
          <span className="stat-label">Gate Saves</span>
        </div>
      </div>

      {/* Trend chart */}
      {data.quizHistory.length > 0 && (
        <div className="chart-section">
          <div className="chart-title">Score trend — last {data.quizHistory.length} quiz{data.quizHistory.length > 1 ? 'zes' : ''}</div>
          <QuizChart history={data.quizHistory} />
          <div className="chart-legend">
            <span className="legend-dot" style={{ background: '#00e676' }} />≥80%&nbsp;&nbsp;
            <span className="legend-dot" style={{ background: '#ffa726' }} />≥50%&nbsp;&nbsp;
            <span className="legend-dot" style={{ background: '#ff5252' }} />{'<'}50%
          </div>
        </div>
      )}

      {/* Accuracy progress bar */}
      <div className="accuracy-section">
        <div className="accuracy-label">
          <span>Overall accuracy</span>
          <span style={{ color: accuracyColor }}>{data.avgAccuracy}%</span>
        </div>
        <div className="accuracy-track">
          <div
            className="accuracy-fill"
            style={{ width: `${data.avgAccuracy}%`, background: accuracyColor }}
          />
          <div className="accuracy-target" style={{ left: '80%' }} title="Target: 80%" />
        </div>
        <div className="accuracy-hint">Target: 80% first-attempt accuracy</div>
      </div>

    </div>
  )
}
