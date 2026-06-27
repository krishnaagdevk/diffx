import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { getGitCommand } from './gitCommand'

const execFileAsync = promisify(execFile)
const GIT_READ_MAX_BUFFER = 32 * 1024 * 1024

export async function getGitDiff(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(getGitCommand(), ['diff', '--no-color', '--no-ext-diff'], {
      cwd: repoPath,
      maxBuffer: GIT_READ_MAX_BUFFER,
    })
    return stdout
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      console.warn('Warning: local Git CLI not found on this system PATH. Local repo tracking is disabled.')
    } else {
      console.error('Failed to run git diff:', error.message)
    }
    return ''
  }
}

export async function getGitDiffStaged(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(getGitCommand(), ['diff', '--cached', '--no-color', '--no-ext-diff'], {
      cwd: repoPath,
      maxBuffer: GIT_READ_MAX_BUFFER,
    })
    return stdout
  } catch {
    return ''
  }
}


export async function stageFile(repoPath: string, filePath: string): Promise<void> {
  await execFileAsync(getGitCommand(), ['add', '--', filePath], {
    cwd: repoPath,
  })
}

export async function unstageFile(repoPath: string, filePath: string): Promise<void> {
  await execFileAsync(getGitCommand(), ['reset', 'HEAD', '--', filePath], {
    cwd: repoPath,
  })
}

export async function commitChanges(repoPath: string, message: string): Promise<void> {
  await execFileAsync(getGitCommand(), ['commit', '-m', message], {
    cwd: repoPath,
  })
}

export async function pushChanges(repoPath: string): Promise<void> {
  await execFileAsync(getGitCommand(), ['push'], {
    cwd: repoPath,
  })
}

export async function stashChanges(repoPath: string): Promise<void> {
  await execFileAsync(getGitCommand(), ['stash', '--include-untracked'], {
    cwd: repoPath,
  })
}

function toGitPath(filePath: string): string {
  return filePath.split('\\').join('/')
}

async function readGitObject(repoPath: string, refPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(getGitCommand(), ['show', refPath], {
      cwd: repoPath,
      maxBuffer: GIT_READ_MAX_BUFFER,
    })
    return stdout
  } catch {
    return null
  }
}

function resolveRepoFilePath(repoPath: string, filePath: string): string | null {
  const root = path.resolve(repoPath)
  const resolved = path.resolve(root, filePath)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return resolved
}

export async function readHeadFile(repoPath: string, filePath: string): Promise<string | null> {
  return readGitObject(repoPath, `HEAD:${toGitPath(filePath)}`)
}

export async function readIndexFile(repoPath: string, filePath: string): Promise<string | null> {
  return readGitObject(repoPath, `:${toGitPath(filePath)}`)
}

export async function readWorkingTreeFile(repoPath: string, filePath: string): Promise<string | null> {
  const absolutePath = resolveRepoFilePath(repoPath, filePath)
  if (absolutePath == null) return null

  try {
    return await readFile(absolutePath, 'utf8')
  } catch {
    return null
  }
}
