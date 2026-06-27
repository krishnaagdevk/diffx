import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(here, '..', '..', '..')

dotenv.config({ path: path.join(rootDir, '.env') })

const port = Number(process.env.PORT ?? 3001)
const diffRepoPath = process.env.DIFF_REPO_PATH ?? null
const corsOrigin = process.env.CORS_ORIGIN ?? '*'
const openaiApiKey = process.env.OPENAI_API_KEY ?? null
const groqApiKey = process.env.GROQ_API_KEY ?? process.env.GROK_API_KEY ?? null
const claudeApiKey = process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? null
const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null
const githubToken = process.env.GITHUB_TOKEN ?? null

export const env = {
  port,
  diffRepoPath,
  corsOrigin,
  openaiApiKey,
  groqApiKey,
  claudeApiKey,
  geminiApiKey,
  githubToken,
} as const

