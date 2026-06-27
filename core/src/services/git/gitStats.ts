import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getGitCommand } from './gitCommand'

const execFileAsync = promisify(execFile)
const MAX_BUF = 16 * 1024 * 1024

export type ContributorStat = {
  name: string
  commits: number
  additions: number
  deletions: number
}

export type RepoSummary = {
  totalCommits: number
  totalContributors: number
  firstCommitDate: string | null
}

export async function getContributorStats(repoPath: string): Promise<ContributorStat[]> {
  try {
    // One pass: get author + numstat together
    const { stdout } = await execFileAsync(
      getGitCommand(),
      ['log', '--no-merges', '--format=COMMIT %aN', '--numstat', '-n', '2000'],
      { cwd: repoPath, maxBuffer: MAX_BUF, timeout: 10_000 },
    )

    const authors = new Map<string, { commits: number; additions: number; deletions: number }>()
    let current: string | null = null

    for (const raw of stdout.split('\n')) {
      const line = raw.trim()
      if (line.startsWith('COMMIT ')) {
        current = line.slice(7).trim()
        if (!authors.has(current)) {
          authors.set(current, { commits: 0, additions: 0, deletions: 0 })
        }
        authors.get(current)!.commits++
        continue
      }
      if (!current || !line) continue
      const parts = line.split('\t')
      if (parts.length >= 2 && parts[0] !== '-' && parts[1] !== '-') {
        const add = parseInt(parts[0], 10) || 0
        const del = parseInt(parts[1], 10) || 0
        authors.get(current)!.additions += add
        authors.get(current)!.deletions += del
      }
    }

    return [...authors.entries()]
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 10)
  } catch {
    return []
  }
}

export async function getRepoSummary(repoPath: string): Promise<RepoSummary> {
  try {
    const [countOut, firstOut] = await Promise.all([
      execFileAsync(getGitCommand(), ['rev-list', '--no-merges', '--count', 'HEAD'], {
        cwd: repoPath, maxBuffer: MAX_BUF, timeout: 5_000,
      }).catch(() => ({ stdout: '0' })),
      execFileAsync(getGitCommand(), ['log', '--no-merges', '--format=%ai', '--reverse', '-n', '1'], {
        cwd: repoPath, maxBuffer: MAX_BUF, timeout: 5_000,
      }).catch(() => ({ stdout: '' })),
    ])

    const totalCommits = parseInt(countOut.stdout.trim(), 10) || 0
    const firstCommitDate = firstOut.stdout.trim().slice(0, 10) || null

    const { stdout: authorsOut } = await execFileAsync(
      getGitCommand(), ['log', '--no-merges', '--format=%aN', '-n', '2000'],
      { cwd: repoPath, maxBuffer: MAX_BUF, timeout: 5_000 },
    ).catch(() => ({ stdout: '' }))

    const unique = new Set(authorsOut.split('\n').map(l => l.trim()).filter(Boolean))

    return { totalCommits, totalContributors: unique.size, firstCommitDate }
  } catch {
    return { totalCommits: 0, totalContributors: 0, firstCommitDate: null }
  }
}
