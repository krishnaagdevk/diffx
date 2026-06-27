import { Router } from 'express'
import { promises as fs } from 'node:fs'

import { getRepoPath, switchRepo, isInManualMode, getManualLabel, exitManualMode } from '../services/diffs/watcher'

export const repoRouter = Router()

repoRouter.get('/repo', (_req, res) => {
  const repoPath = getRepoPath()
  if (!repoPath) {
    res.status(503).json({ error: 'DIFF_REPO_PATH not configured' })
    return
  }
  res.json({
    path: repoPath,
    manual: isInManualMode(),
    manualLabel: getManualLabel(),
  })
})

repoRouter.post('/repo/exit-manual', async (_req, res) => {
  try {
    await exitManualMode()
    res.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to exit manual mode'
    res.status(500).json({ error: message })
  }
})

repoRouter.post('/repo/switch', async (req, res) => {
  const newPath = typeof req.body?.path === 'string' ? req.body.path.trim() : ''
  if (!newPath) {
    res.status(400).json({ error: 'path is required' })
    return
  }

  // Verify it's an existing directory with a .git folder
  try {
    await fs.access(newPath)
    await fs.access(`${newPath}/.git`)
  } catch {
    res.status(400).json({ error: 'Path is not a valid git repository' })
    return
  }

  try {
    await switchRepo(newPath)
    res.json({ ok: true, path: newPath })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to switch repo'
    res.status(500).json({ error: message })
  }
})
