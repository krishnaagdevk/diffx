import { Router } from 'express'

import { buildCombinedDiff } from '../services/ai/diffContext'
import { getLatestDiff, getRepoPath } from '../services/diffs/watcher'
import {
  type DiffFileDescriptor,
  parseChangedFilesFromPatch,
} from '../services/diffs/patchFiles'
import { readHeadFile, readIndexFile, readWorkingTreeFile } from '../services/git/gitDiff'
import { computeDiffHash } from '../services/quizResults'
import { reconstructFileFromPatch } from '../services/diffs/patchReconstructor'

export const diffsRouter = Router()

diffsRouter.get('/diffs/latest', (_req, res) => {
  if (!getRepoPath()) {
    res.status(503).json({ error: 'DIFF_REPO_PATH not configured' })
    return
  }
  const latest = getLatestDiff()
  const fullDiff = buildCombinedDiff(latest)
  res.json({ ...latest, diffHash: computeDiffHash(fullDiff) })
})

function asQueryString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

type FileContentsPayload = {
  status: 'staged' | 'unstaged'
  path: string
  prevPath?: string
  type: DiffFileDescriptor['type']
  oldFile: { name: string; contents: string }
  newFile: { name: string; contents: string }
}

async function loadDiffFileContents(
  repoPath: string,
  file: DiffFileDescriptor
): Promise<FileContentsPayload | null> {
  const oldName = file.prevPath ?? file.path
  const newName = file.path

  try {
    const [oldContentsRaw, newContentsRaw] =
      file.status === 'staged'
        ? await Promise.all([readHeadFile(repoPath, oldName), readIndexFile(repoPath, newName)])
        : await Promise.all([readIndexFile(repoPath, oldName), readWorkingTreeFile(repoPath, newName)])

    let oldContents = oldContentsRaw
    let newContents = newContentsRaw

    if (oldContents == null || newContents == null) {
      const latest = getLatestDiff()
      const patchText = file.status === 'staged' ? latest.staged : latest.unstaged
      const reconstructed = reconstructFileFromPatch(patchText, file.path)
      if (reconstructed) {
        oldContents = oldContents ?? reconstructed.oldContents
        newContents = newContents ?? reconstructed.newContents
      }
    }

    const allowsMissingOld = file.type === 'new'
    const allowsMissingNew = file.type === 'deleted'

    if (oldContents == null && !allowsMissingOld) return null
    if (newContents == null && !allowsMissingNew) return null

    return {
      status: file.status,
      path: file.path,
      prevPath: file.prevPath,
      type: file.type,
      oldFile: {
        name: oldName,
        contents: oldContents ?? '',
      },
      newFile: {
        name: newName,
        contents: newContents ?? '',
      },
    }
  } catch (error) {
    console.error(`Failed to load file contents for ${file.path} (${file.status}):`, error)
    return null
  }
}

diffsRouter.get('/diffs/files-contents', async (_req, res) => {
  const repoPath = getRepoPath()
  if (!repoPath) {
    res.status(503).json({ error: 'DIFF_REPO_PATH not configured' })
    return
  }

  const latest = getLatestDiff()
  const fullDiff = buildCombinedDiff(latest)
  const diffHash = computeDiffHash(fullDiff)
  const changedFiles = [
    ...parseChangedFilesFromPatch(latest.staged, 'staged'),
    ...parseChangedFilesFromPatch(latest.unstaged, 'unstaged'),
  ]

  if (changedFiles.length === 0) {
    res.json({ diffHash, files: [] })
    return
  }

  const payload = (
    await Promise.all(changedFiles.map((file) => loadDiffFileContents(repoPath, file)))
  ).filter((file): file is FileContentsPayload => file != null)

  res.json({
    diffHash,
    files: payload,
  })
})

diffsRouter.get('/diffs/file-contents', async (req, res) => {
  const repoPath = getRepoPath()
  if (!repoPath) {
    res.status(503).json({ error: 'DIFF_REPO_PATH not configured' })
    return
  }

  const status = asQueryString(req.query.status)
  const filePath = asQueryString(req.query.path)
  const name = asQueryString(req.query.name)
  const prevName = asQueryString(req.query.prevName)
  const type = asQueryString(req.query.type)

  if (status !== 'staged' && status !== 'unstaged') {
    res.status(400).json({ error: 'status must be staged or unstaged' })
    return
  }

  if (!filePath) {
    res.status(400).json({ error: 'path is required' })
    return
  }

  const oldName = prevName ?? filePath
  const newName = name ?? filePath

  try {
    const [oldContentsRaw, newContentsRaw] =
      status === 'staged'
        ? await Promise.all([readHeadFile(repoPath, oldName), readIndexFile(repoPath, newName)])
        : await Promise.all([readIndexFile(repoPath, oldName), readWorkingTreeFile(repoPath, newName)])

    let oldContents = oldContentsRaw
    let newContents = newContentsRaw

    if (oldContents == null || newContents == null) {
      const latest = getLatestDiff()
      const patchText = status === 'staged' ? latest.staged : latest.unstaged
      const reconstructed = reconstructFileFromPatch(patchText, filePath)
      if (reconstructed) {
        oldContents = oldContents ?? reconstructed.oldContents
        newContents = newContents ?? reconstructed.newContents
      }
    }

    const allowsMissingOld = type === 'new'
    const allowsMissingNew = type === 'deleted'

    if (oldContents == null && !allowsMissingOld) {
      res.status(404).json({ error: `Could not load old file contents for ${oldName}` })
      return
    }

    if (newContents == null && !allowsMissingNew) {
      res.status(404).json({ error: `Could not load new file contents for ${newName}` })
      return
    }

    res.json({
      oldFile: {
        name: oldName,
        contents: oldContents ?? '',
      },
      newFile: {
        name: newName,
        contents: newContents ?? '',
      },
    })
  } catch (error) {
    console.error('Failed to load file contents:', error)
    res.status(500).json({ error: 'Failed to load file contents' })
  }
})
