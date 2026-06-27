import { getCodexThread } from './codexClient'
import { CODEX_MODELS } from './models'
import { normalizeToText } from './normalize'
import { extractJsonObject } from './commitMessage'

export type TestHint = {
  area: string
  description: string
  priority: 'high' | 'medium' | 'low'
}

export async function generateTestHints(
  fullDiff: string,
  repoPath: string | null,
): Promise<TestHint[]> {
  const thread = getCodexThread(CODEX_MODELS.quality)

  const prompt = [
    'You are a test coverage advisor. Analyze this code diff and identify what tests should be written or updated.',
    'Return ONLY JSON: {"hints": [{"area":"...", "description":"...", "priority":"high|medium|low"}]}',
    'Focus on: untested functions, edge cases, regression risks, integration points.',
    'Return 3-6 actionable hints. If no tests are needed, return {"hints":[]}.',
    `Repository: ${repoPath ?? 'unknown'}`,
    '--- DIFF ---',
    fullDiff,
  ].join('\n')

  const response = await thread.run(prompt, { json: true })
  const text = normalizeToText(response) ?? ''
  const parsed = extractJsonObject(text) as { hints?: unknown[] } | null

  if (!parsed || !Array.isArray(parsed.hints)) return []

  return parsed.hints
    .map((h: unknown) => {
      if (!h || typeof h !== 'object') return null
      const hint = h as Record<string, unknown>
      const area = typeof hint.area === 'string' ? hint.area.trim() : ''
      const description = typeof hint.description === 'string' ? hint.description.trim() : ''
      const priority =
        hint.priority === 'high' || hint.priority === 'medium' || hint.priority === 'low'
          ? hint.priority
          : 'medium'
      if (!area || !description) return null
      return { area, description, priority } as TestHint
    })
    .filter((h): h is TestHint => h !== null)
}
