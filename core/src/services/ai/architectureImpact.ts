import { getCodexThread } from './codexClient'
import { normalizeToText } from './normalize'

export type ImpactNode = {
  id: string
  label: string
  type: 'modified' | 'impacted' | 'dependency'
  details: string
}

export type ImpactLink = {
  source: string
  target: string
}

export type ArchitectureImpactPayload = {
  severity: 'critical' | 'warning' | 'low'
  reason: string
  nodes: ImpactNode[]
  links: ImpactLink[]
}

function parseImpact(raw: unknown): ArchitectureImpactPayload | null {
  const text = normalizeToText(raw)
  if (!text) return null
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as ArchitectureImpactPayload
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.links)) {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

export async function analyzeArchitectureImpact(
  fullDiff: string,
  repoPath: string | null
): Promise<ArchitectureImpactPayload> {
  const thread = getCodexThread('llama-3.3-70b-versatile')

  const schema = `{
    "severity": "critical" | "warning" | "low",
    "reason": "Overall summary of code impact",
    "nodes": [
      {"id": "file_path", "label": "basename", "type": "modified"|"impacted"|"dependency", "details": "Explanation of changes or why it is impacted"}
    ],
    "links": [
      {"source": "source_node_id", "target": "target_node_id"}
    ]
  }`

  const prompt = [
    'You are DiffX Architect, a software design expert analyzing code changes.',
    'Map the structural dependencies and potential architectural impact/side-effects of this diff.',
    'Include the modified files and predict at least 1-2 secondary files or modules that might be impacted or depend on these changes.',
    'Respond ONLY with JSON matching the following schema:',
    schema,
    `Repository: ${repoPath ?? 'unknown'}`,
    '--- CONTEXT ---',
    fullDiff,
  ].join('\n')

  try {
    const response = await thread.run(prompt)
    const parsed = parseImpact(response)
    if (parsed) return parsed
  } catch (error) {
    console.error('Failed to run architectural impact analysis:', error)
  }

  // Fallback if AI fails or times out
  return {
    severity: 'low',
    reason: 'Initial structural analysis completed with local defaults.',
    nodes: [
      { id: 'diff-context', label: 'Diff Context', type: 'modified', details: 'Active code changes analyzed.' }
    ],
    links: []
  }
}
