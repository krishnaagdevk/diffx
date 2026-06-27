/**
 * Reconstructs the old and new file contents of a specific file from a unified git diff patch.
 * This is extremely useful for remote/public repositories where full local files do not exist.
 */
export function reconstructFileFromPatch(
  patchText: string,
  targetPath: string
): { oldContents: string; newContents: string } | null {
  if (!patchText) return null

  const lines = patchText.split('\n')
  let isTargetFile = false
  const oldLines: string[] = []
  const newLines: string[] = []
  let foundFile = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Detect file boundary
    if (line.startsWith('diff --git ')) {
      isTargetFile = line.includes(`a/${targetPath} `) || line.includes(`b/${targetPath}`)
      if (isTargetFile) {
        foundFile = true
      }
      continue
    }

    if (!isTargetFile) continue

    // Skip metadata headers, stop at hunks
    if (
      line.startsWith('index ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      continue
    }

    if (line.startsWith('@@ ')) {
      continue
    }

    // Process hunk lines
    if (line.startsWith('+')) {
      newLines.push(line.slice(1))
    } else if (line.startsWith('-')) {
      oldLines.push(line.slice(1))
    } else if (line.startsWith(' ')) {
      oldLines.push(line.slice(1))
      newLines.push(line.slice(1))
    } else {
      // If we hit any other git metadata line, stop processing this file
      if (line.startsWith('diff --git ')) {
        isTargetFile = false
      }
    }
  }

  if (!foundFile) return null

  return {
    oldContents: oldLines.join('\n'),
    newContents: newLines.join('\n'),
  }
}
