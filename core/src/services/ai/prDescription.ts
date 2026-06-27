import { getCodexThread } from './codexClient'
import { CODEX_MODELS } from './models'
import { normalizeToText } from './normalize'
import { extractJsonObject } from './commitMessage'

export type PRDescription = {
  title: string
  body: string
}

export async function generatePRDescription(
  fullDiff: string,
  repoPath: string | null,
): Promise<PRDescription> {
  const thread = getCodexThread(CODEX_MODELS.commitMessage)

  const prompt = [
    'You are DiffX. Generate a GitHub pull request description for these changes.',
    'Return ONLY JSON with this exact shape:',
    '{"title":"...", "body":"..."}',
    'The title should be a concise PR title (under 72 chars).',
    'The body should be markdown with these sections:',
    '## Summary\n(2-3 bullets describing what changed and why)',
    '## Changes\n(bulleted list of key technical changes)',
    '## Test Plan\n(checklist of what to test)',
    `Repository: ${repoPath ?? 'unknown'}`,
    '--- DIFF ---',
    fullDiff,
  ].join('\n')

  const response = await thread.run(prompt, { json: true })
  const text = normalizeToText(response) ?? ''

  const parsed = extractJsonObject(text) as PRDescription | null
  if (!parsed || typeof parsed.title !== 'string' || typeof parsed.body !== 'string') {
    throw new Error('PR description generation failed')
  }
  return { title: parsed.title.trim(), body: parsed.body.trim() }
}
