import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getGitCommand } from './gitCommand'

const execFileAsync = promisify(execFile)
const MAX_BUF = 32 * 1024 * 1024

export async function listBranches(repoPath: string): Promise<{ name: string; current: boolean }[]> {
  try {
    const { stdout } = await execFileAsync(
      getGitCommand(), ['branch', '-a', '--format=%(refname:short) %(HEAD)'],
      { cwd: repoPath, maxBuffer: MAX_BUF, timeout: 5000 },
    )
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const parts = line.split(' ')
        const current = parts[parts.length - 1] === '*'
        const name = parts.slice(0, current ? -1 : undefined).join(' ').trim()
        return { name, current }
      })
      .filter(b => b.name)
  } catch {
    return []
  }
}

export async function getBranchDiff(
  repoPath: string,
  base: string,
  compare: string,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      getGitCommand(), ['diff', '--no-color', '--no-ext-diff', `${base}...${compare}`],
      { cwd: repoPath, maxBuffer: MAX_BUF, timeout: 15000 },
    )
    return stdout
  } catch (err: any) {
    throw new Error(err?.message ?? 'Failed to get branch diff')
  }
}
