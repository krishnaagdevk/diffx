import { env } from '../../config/env'

export interface AICallOpts {
  /** When true, providers use constrained JSON mode (no markdown fences, guaranteed object). */
  json?: boolean
}

export interface CodexThread {
  run(prompt: string, opts?: AICallOpts): Promise<string>
}

const AI_TIMEOUT_MS = 60_000

const STRICT_JSON_INSTRUCTION =
  'You are a JSON API. Output ONLY a valid JSON object — no markdown code fences, no ```json, no explanation, no preamble. Your response MUST start with { and end with }.'

/**
 * Split a prompt at the first data-block separator so system instructions stay
 * separate from the diff/context payload.  Works for all our prompts which use
 * markers like "--- DIFF ---", "--- CONTEXT ---", "--- RULES ---".
 */
function splitPrompt(prompt: string): { system: string; user: string } {
  const sep = /\n---[ \t]*(DIFF|CONTEXT|RULES)[ \t]*---/
  const m = sep.exec(prompt)
  if (m && m.index !== undefined) {
    return {
      system: prompt.slice(0, m.index).trim(),
      user: prompt.slice(m.index + 1).trim(),
    }
  }
  return { system: '', user: prompt }
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

async function callClaude(prompt: string, opts?: AICallOpts): Promise<string> {
  if (!env.claudeApiKey) throw new Error('CLAUDE_API_KEY not configured')

  const { system, user } = splitPrompt(prompt)
  const systemMsg = opts?.json
    ? (system ? `${system}\n\n${STRICT_JSON_INSTRUCTION}` : STRICT_JSON_INSTRUCTION)
    : system

  const body: Record<string, unknown> = {
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: user || prompt }],
  }
  if (systemMsg) body.system = systemMsg

  const response = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    },
    AI_TIMEOUT_MS,
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Claude API error (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>
  }
  const text = data.content?.find(b => b.type === 'text')?.text
  if (!text) throw new Error('Claude returned empty response')
  return text
}

async function callGroq(prompt: string, opts?: AICallOpts): Promise<string> {
  if (!env.groqApiKey) throw new Error('GROQ_API_KEY not configured')

  const { system, user } = splitPrompt(prompt)
  const systemContent = opts?.json
    ? (system ? `${system}\n\n${STRICT_JSON_INSTRUCTION}` : STRICT_JSON_INSTRUCTION)
    : system

  const messages: Array<{ role: string; content: string }> = []
  if (systemContent) messages.push({ role: 'system', content: systemContent })
  messages.push({ role: 'user', content: user || prompt })

  const body: Record<string, unknown> = {
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.1,
  }
  // Constrained JSON decoding: guarantees valid JSON, no markdown wrapping
  if (opts?.json) body.response_format = { type: 'json_object' }

  const response = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.groqApiKey}`,
      },
      body: JSON.stringify(body),
    },
    AI_TIMEOUT_MS,
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Groq API error (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Groq returned empty response')
  return content
}

async function callGemini(prompt: string, opts?: AICallOpts): Promise<string> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY not configured')

  const { system, user } = splitPrompt(prompt)
  const systemText = opts?.json
    ? (system ? `${system}\n\n${STRICT_JSON_INSTRUCTION}` : STRICT_JSON_INSTRUCTION)
    : system

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: user || prompt }] }],
    generationConfig: {
      temperature: 0.1,
      ...(opts?.json ? { responseMimeType: 'application/json' } : {}),
    },
  }
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] }

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    AI_TIMEOUT_MS,
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned empty response')
  return text
}

class FallbackCodexThread implements CodexThread {
  async run(prompt: string, opts?: AICallOpts): Promise<string> {
    const errors: string[] = []

    if (env.claudeApiKey) {
      try {
        const result = await callClaude(prompt, opts)
        console.log('[AI] Using Claude')
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[AI] Claude failed, falling back to Groq:', msg)
        errors.push(`Claude: ${msg}`)
      }
    }

    if (env.groqApiKey) {
      try {
        const result = await callGroq(prompt, opts)
        console.log('[AI] Using Groq')
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[AI] Groq failed, falling back to Gemini:', msg)
        errors.push(`Groq: ${msg}`)
      }
    }

    if (env.geminiApiKey) {
      try {
        const result = await callGemini(prompt, opts)
        console.log('[AI] Using Gemini')
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[AI] Gemini failed:', msg)
        errors.push(`Gemini: ${msg}`)
      }
    }

    throw new Error(
      `All AI providers failed. Errors: ${errors.join(' | ') || 'No API keys configured.'}`,
    )
  }
}

export function getCodexThread(_model?: string): CodexThread {
  return new FallbackCodexThread()
}
