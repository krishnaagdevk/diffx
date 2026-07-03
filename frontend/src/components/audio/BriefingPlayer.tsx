import { useEffect, useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import './BriefingPlayer.css'

function stripMarkdown(text: string): string {
  if (!text) return ''
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove headers
    .replace(/^#+\s+/gm, '')
    // Remove bold/italic markers
    .replace(/\*{1,3}/g, '')
    .replace(/_{1,3}/g, '')
    // Remove inline code ticks
    .replace(/`/g, '')
    // Remove link syntax but keep link text, e.g. [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove list bullet characters (keep the text next to it)
    .replace(/^[\s]*[-*+]\s+/gm, '')
    // Remove numbered lists starts like '1. '
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove blockquote symbol '>'
    .replace(/^>\s+/gm, '')
    // Remove strikethroughs
    .replace(/~~/g, '')
    // Clean up excessive whitespace/newlines
    .replace(/\n+/g, ' ')
    .trim()
}


type BriefingPlayerProps = {
  hasChanges: boolean
  triggerReloadKey?: number
}

export function BriefingPlayer({ hasChanges, triggerReloadKey }: BriefingPlayerProps) {
  const [briefingText, setBriefingText] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>('')
  const [playbackRate, setPlaybackRate] = useState<number>(1.05)
  const [baseDuration, setBaseDuration] = useState(0)
  const [regenTrigger, setRegenTrigger] = useState(0)

  const timerRef = useRef<any>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  useEffect(() => {
    synthRef.current = window.speechSynthesis
    
    const updateVoices = () => {
      if (synthRef.current) {
        const availableVoices = synthRef.current.getVoices()
        setVoices(availableVoices)
        
        // Select a premium English voice by default if available
        const preferredVoice = availableVoices.find(
          (v) => v.name.includes('Google') || v.name.includes('Natural') || (v.lang.startsWith('en') && v.name.includes('US'))
        )
        if (preferredVoice) {
          setSelectedVoiceName(preferredVoice.name)
        } else if (availableVoices.length > 0) {
          setSelectedVoiceName(availableVoices[0].name)
        }
      }
    }

    updateVoices()
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices
    }

    return () => {
      if (synthRef.current) {
        synthRef.current.cancel()
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasChanges) {
      setBriefingText('')
      return
    }

    setLoading(true)
    setError(null)
    setIsPlaying(false)
    setIsPaused(false)
    setCurrentTime(0)

    if (synthRef.current) {
      synthRef.current.cancel()
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }

    // Generate a beautiful, concise architectural walk-through script via Llama-3!
    fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/ai/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Generate a 1-minute audio podcast style walkthrough script of these code changes. Address the listener as a fellow engineer. Highlight what files changed, what main logic was updated, and any potential side-effects or architectural warnings. Keep it engaging, natural, and concise.',
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to generate walkthrough.')
        return res.json() as Promise<{ answer: string }>
      })
      .then((data) => {
        setBriefingText(data.answer)
        // Estimate speech duration based on average speaking rate (approx 140 words per minute)
        const wordCount = data.answer.split(/\s+/).length
        const estimatedBase = Math.max(15, Math.round((wordCount / 140) * 60))
        setBaseDuration(estimatedBase)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Briefing generation failed.')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [hasChanges, triggerReloadKey, regenTrigger])

  useEffect(() => {
    setDuration(Math.max(10, Math.round(baseDuration / playbackRate)))
  }, [baseDuration, playbackRate])

  const handlePlayPause = () => {
    if (!synthRef.current || !briefingText) return

    if (isPlaying) {
      if (isPaused) {
        // Resume
        synthRef.current.resume()
        setIsPaused(false)
        startProgressTimer()
      } else {
        // Pause
        synthRef.current.pause()
        setIsPaused(true)
        if (timerRef.current) clearInterval(timerRef.current)
      }
    } else {
      // Start fresh playback
      synthRef.current.cancel()
      if (timerRef.current) clearInterval(timerRef.current)

      const cleanText = stripMarkdown(briefingText)
      const utterance = new SpeechSynthesisUtterance(cleanText)
      
      // Select chosen voice
      const availableVoices = synthRef.current.getVoices()
      const selectedVoice = availableVoices.find((v) => v.name === selectedVoiceName)
      if (selectedVoice) {
        utterance.voice = selectedVoice
      } else {
        const preferredVoice = availableVoices.find(
          (v) => v.name.includes('Google') || v.name.includes('Natural') || v.lang === 'en-US'
        )
        if (preferredVoice) utterance.voice = preferredVoice
      }

      utterance.rate = playbackRate
      utterance.pitch = 1.0

      utterance.onend = () => {
        setIsPlaying(false)
        setIsPaused(false)
        setCurrentTime(0)
        if (timerRef.current) clearInterval(timerRef.current)
      }

      utterance.onerror = () => {
        setIsPlaying(false)
        setIsPaused(false)
        if (timerRef.current) clearInterval(timerRef.current)
      }

      utteranceRef.current = utterance
      setIsPlaying(true)
      setIsPaused(false)
      setCurrentTime(0)
      
      synthRef.current.speak(utterance)
      startProgressTimer()
    }
  }

  const startProgressTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCurrentTime((prev) => {
        if (prev >= duration) {
          if (timerRef.current) clearInterval(timerRef.current)
          return duration
        }
        return prev + 1
      })
    }, 1000)
  }

  const handleStop = () => {
    if (synthRef.current) {
      synthRef.current.cancel()
    }
    if (timerRef.current) clearInterval(timerRef.current)
    setIsPlaying(false)
    setIsPaused(false)
    setCurrentTime(0)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (!hasChanges) {
    return (
      <div className="audio-empty">
        <div className="audio-empty-icon">🎙️</div>
        <h3>No Walkthrough Available</h3>
        <p>Load a git repository changes diff to generate a live, interactive audio walkthrough briefing.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="audio-loading">
        <div className="audio-spinner" />
        <h3>Synthesizing AI Podcast Walkthrough...</h3>
        <p>Converting code diffs to natural speech scripts, modeling engineering insights...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="audio-error">
        <div className="audio-error-icon">⚠️</div>
        <h3>Audio Briefing Failed</h3>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div className="briefing-player">
      <div className="player-inner">
        {/* Glassmorphic Audio Deck Header */}
        <div className="audio-deck-header">
          <span className="deck-tag">🎙️ PR PODCAST WALKTHROUGH</span>
          <h2>Voice briefing & Standup Assistant</h2>
        </div>

        {/* Unified Audio Deck */}
        <div className="audio-deck">
          <div className="deck-main">
            <div className={`audio-waves ${isPlaying && !isPaused ? 'is-active' : ''}`}>
              <span className="bar bar1" />
              <span className="bar bar2" />
              <span className="bar bar3" />
              <span className="bar bar4" />
              <span className="bar bar5" />
              <span className="bar bar6" />
              <span className="bar bar7" />
              <span className="bar bar8" />
            </div>
            <div className="audio-time-stamp">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          {/* Progress bar deck */}
          <div className="audio-progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${(currentTime / duration) * 100}%` }}
            />
          </div>

          {/* Audio Deck Controls Panel */}
          <div className="audio-controls">
            <button 
              type="button" 
              onClick={handlePlayPause}
              className={`control-btn main-play-btn ${isPlaying && !isPaused ? 'is-playing' : ''}`}
              title={isPlaying && !isPaused ? 'Pause Briefing' : 'Play Briefing'}
            >
              {isPlaying && !isPaused ? '⏸️' : '▶️'}
            </button>
            {isPlaying && (
              <button 
                type="button" 
                onClick={handleStop}
                className="control-btn stop-btn"
                title="Stop Briefing"
              >
                ⏹️
              </button>
            )}
          </div>
        </div>

        {/* Audio settings: Voice, speed and regeneration */}
        <div className="player-settings">
          <div className="settings-row">
            <div className="setting-group voice-group">
              <label htmlFor="voice-select">Voice</label>
              <select
                id="voice-select"
                value={selectedVoiceName}
                onChange={(e) => {
                  setSelectedVoiceName(e.target.value)
                  if (isPlaying) handleStop()
                }}
                className="settings-select"
              >
                {voices.length === 0 ? (
                  <option value="">Default System Voice</option>
                ) : (
                  voices.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="setting-group speed-group">
              <label htmlFor="speed-select">Speed</label>
              <select
                id="speed-select"
                value={playbackRate}
                onChange={(e) => {
                  setPlaybackRate(parseFloat(e.target.value))
                  if (isPlaying) handleStop()
                }}
                className="settings-select"
              >
                <option value="0.8">0.8x</option>
                <option value="1.0">1.0x</option>
                <option value="1.2">1.2x</option>
                <option value="1.5">1.5x</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            className="regenerate-btn"
            onClick={() => setRegenTrigger((prev) => prev + 1)}
            disabled={loading}
            title="Regenerate walkthrough script from LLM"
          >
            🔄 Regenerate Walkthrough
          </button>
        </div>

        {/* Script script review expansion */}
        {briefingText && (
          <details className="briefing-transcript">
            <summary>View Speech Transcript</summary>
            <div className="transcript-body review-markdown">
              <ReactMarkdown>{briefingText}</ReactMarkdown>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
