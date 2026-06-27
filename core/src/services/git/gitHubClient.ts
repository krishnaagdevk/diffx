import { env } from '../../config/env'

const GITHUB_API = 'https://api.github.com'
const TIMEOUT_MS = 30_000

function githubHeaders(acceptDiff = false): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'diffx-app',
    'Accept': acceptDiff
      ? 'application/vnd.github.v3.diff'
      : 'application/vnd.github+json',
  }
  if (env.githubToken) {
    headers['Authorization'] = `Bearer ${env.githubToken}`
  }
  return headers
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchDiff(apiUrl: string): Promise<string> {
  const response = await fetchWithTimeout(apiUrl, { headers: githubHeaders(true) })

  if (response.status === 401) throw new Error('GitHub authentication failed. Check your GITHUB_TOKEN.')
  if (response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (remaining === '0') throw new Error('GitHub API rate limit exceeded. Add a GITHUB_TOKEN to your .env to increase the limit.')
    throw new Error('GitHub API access denied (403).')
  }
  if (response.status === 404) throw new Error('GitHub PR or commit not found. Check the URL.')
  if (!response.ok) throw new Error(`GitHub API error (${response.status}): ${response.statusText}`)

  const text = await response.text()
  if (!text.trim()) throw new Error('GitHub returned an empty diff. The PR/commit may have no file changes.')
  return text
}

export async function fetchDiffFromUrl(inputUrl: string): Promise<{ diff: string; repoName: string }> {
  const url = new URL(inputUrl.trim())

  if (url.hostname !== 'github.com') {
    throw new Error('Only github.com URLs are supported.')
  }

  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) throw new Error('Invalid GitHub URL — must include owner and repo.')

  const owner = parts[0]
  const repo = parts[1]
  const repoName = `${owner}/${repo}`

  // PR: github.com/owner/repo/pull/123
  if (parts[2] === 'pull' && parts[3]) {
    const prNumber = parseInt(parts[3], 10)
    if (isNaN(prNumber)) throw new Error('Invalid pull request number in URL.')
    const diff = await fetchDiff(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`)
    return { diff, repoName }
  }

  // Commit: github.com/owner/repo/commit/sha
  if (parts[2] === 'commit' && parts[3]) {
    const sha = parts[3]
    const diff = await fetchDiff(`${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}`)
    return { diff, repoName }
  }

  // Bare repo URL — fetch the latest open PR
  if (parts.length === 2) {
    const listRes = await fetchWithTimeout(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&per_page=1`,
      { headers: githubHeaders() },
    )
    if (!listRes.ok) throw new Error(`Could not fetch pull requests for ${repoName} (${listRes.status}).`)
    const prs = (await listRes.json()) as Array<{ number?: number }>
    if (!prs.length || !prs[0].number) throw new Error(`No open pull requests found in ${repoName}.`)
    const diff = await fetchDiff(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${prs[0].number}`)
    return { diff, repoName }
  }

  throw new Error('Unsupported GitHub URL format. Paste a PR URL (…/pull/123) or commit URL (…/commit/abc).')
}
