import { existsSync } from 'node:fs'
import path from 'node:path'

let resolvedGitPath: string | null = null

/**
 * Returns the resolved git command (absolute path or 'git') and ensures
 * its directory is in process.env.PATH on Windows.
 */
export function getGitCommand(): string {
  if (resolvedGitPath !== null) {
    return resolvedGitPath
  }

  if (process.platform === 'win32') {
    const commonPaths = [
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files\\Git\\bin\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\bin\\git.exe',
    ]

    const userProfile = process.env.USERPROFILE
    if (userProfile) {
      commonPaths.push(path.join(userProfile, 'AppData\\Local\\Programs\\Git\\cmd\\git.exe'))
      commonPaths.push(path.join(userProfile, 'AppData\\Local\\Programs\\Git\\bin\\git.exe'))
    }

    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) {
      commonPaths.push(path.join(localAppData, 'Programs\\Git\\cmd\\git.exe'))
      commonPaths.push(path.join(localAppData, 'Programs\\Git\\bin\\git.exe'))
    }

    for (const p of commonPaths) {
      if (existsSync(p)) {
        resolvedGitPath = p
        // Prepend the git directory to process.env.PATH so any other child processes find it
        const gitDir = path.dirname(p)
        const envPath = process.env.PATH || ''
        const paths = envPath.split(path.delimiter)
        if (!paths.includes(gitDir)) {
          process.env.PATH = `${gitDir}${path.delimiter}${envPath}`
        }
        return p
      }
    }
  }

  resolvedGitPath = 'git'
  return resolvedGitPath
}
