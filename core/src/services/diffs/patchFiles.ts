export type DiffStatus = 'staged' | 'unstaged'
export type DiffFileType = 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted'

export type DiffFileDescriptor = {
  status: DiffStatus
  path: string
  prevPath?: string
  type: DiffFileType
}

type MutableDiffFileDescriptor = {
  status: DiffStatus
  headerOldPath?: string
  headerNewPath?: string
  markerOldPath?: string | null
  markerNewPath?: string | null
  renameFrom?: string
  renameTo?: string
  sawHunk: boolean
  sawNewFileMode: boolean
  sawDeletedFileMode: boolean
}

function decodeGitQuotedPath(path: string): string {
  return path
    .replace(/\\(["\\])/g, '$1')
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
}

function parseGitDiffHeader(line: string): { oldPath?: string; newPath?: string } | null {
  const quotedMatch = line.match(
    /^diff --git "a\/((?:[^"\\]|\\.)+)" "b\/((?:[^"\\]|\\.)+)"$/
  )
  if (quotedMatch) {
    return {
      oldPath: decodeGitQuotedPath(quotedMatch[1]),
      newPath: decodeGitQuotedPath(quotedMatch[2]),
    }
  }

  const plainMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/)
  if (!plainMatch) return null
  return {
    oldPath: plainMatch[1],
    newPath: plainMatch[2],
  }
}

function parsePatchFilePath(raw: string, prefix: 'a/' | 'b/'): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '/dev/null') return null

  let unquoted = trimmed
  if (unquoted.startsWith('"') && unquoted.endsWith('"')) {
    unquoted = decodeGitQuotedPath(unquoted.slice(1, -1))
  }

  if (unquoted.startsWith(prefix)) {
    return unquoted.slice(prefix.length)
  }

  return unquoted
}

function parseRenamePath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return decodeGitQuotedPath(trimmed.slice(1, -1))
  }
  return decodeGitQuotedPath(trimmed)
}

function getResolvedPath(
  first: string | null | undefined,
  second: string | null | undefined
): string | undefined {
  if (first != null) return first
  if (second != null) return second
  return undefined
}

function finalizeDescriptor(
  descriptor: MutableDiffFileDescriptor | null
): DiffFileDescriptor | null {
  if (!descriptor) return null

  const oldPath = getResolvedPath(
    descriptor.renameFrom,
    getResolvedPath(descriptor.markerOldPath, descriptor.headerOldPath)
  )
  const newPath = getResolvedPath(
    descriptor.renameTo,
    getResolvedPath(descriptor.markerNewPath, descriptor.headerNewPath)
  )

  if (oldPath == null && newPath == null) return null

  let type: DiffFileType
  if (descriptor.sawNewFileMode || oldPath == null) {
    type = 'new'
  } else if (descriptor.sawDeletedFileMode || newPath == null) {
    type = 'deleted'
  } else if (oldPath !== newPath) {
    type = descriptor.sawHunk ? 'rename-changed' : 'rename-pure'
  } else {
    type = 'change'
  }

  const path = newPath ?? oldPath
  if (!path) return null

  return {
    status: descriptor.status,
    path,
    prevPath: oldPath && oldPath !== path ? oldPath : undefined,
    type,
  }
}

export function parseChangedFilesFromPatch(
  patchText: string,
  status: DiffStatus
): DiffFileDescriptor[] {
  if (!patchText.trim()) return []

  const lines = patchText.split('\n')
  const descriptors: DiffFileDescriptor[] = []
  const seen = new Set<string>()
  let current: MutableDiffFileDescriptor | null = null

  const pushCurrent = () => {
    const finalized = finalizeDescriptor(current)
    if (!finalized) return
    const key = `${finalized.status}:${finalized.path}:${finalized.prevPath ?? ''}:${finalized.type}`
    if (seen.has(key)) return
    seen.add(key)
    descriptors.push(finalized)
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      pushCurrent()
      const header = parseGitDiffHeader(line)
      current = {
        status,
        headerOldPath: header?.oldPath,
        headerNewPath: header?.newPath,
        sawHunk: false,
        sawNewFileMode: false,
        sawDeletedFileMode: false,
      }
      continue
    }

    if (!current) continue

    if (line.startsWith('rename from ')) {
      current.renameFrom = parseRenamePath(line.slice('rename from '.length))
      continue
    }
    if (line.startsWith('rename to ')) {
      current.renameTo = parseRenamePath(line.slice('rename to '.length))
      continue
    }
    if (line.startsWith('new file mode ')) {
      current.sawNewFileMode = true
      continue
    }
    if (line.startsWith('deleted file mode ')) {
      current.sawDeletedFileMode = true
      continue
    }
    if (line.startsWith('--- ')) {
      current.markerOldPath = parsePatchFilePath(line.slice(4), 'a/')
      continue
    }
    if (line.startsWith('+++ ')) {
      current.markerNewPath = parsePatchFilePath(line.slice(4), 'b/')
      continue
    }
    if (line.startsWith('@@ ')) {
      current.sawHunk = true
    }
  }

  pushCurrent()
  return descriptors
}
