import cors from 'cors'
import express from 'express'
import swaggerUi from 'swagger-ui-express'

import { env } from './config/env'
import { diffsRouter } from './routes/diffs'
import { gitRouter } from './routes/git'
import { healthRouter } from './routes/health'
import { repoRouter } from './routes/repo'
import { aiRouter } from './routes/ai'
import { statsRouter } from './routes/stats'
import { swaggerDocument } from './swagger'

export function createApp() {
  const app = express()
  

  app.use(cors({ origin: env.corsOrigin }))
  app.use(express.json())

  app.use(healthRouter)
  app.use(diffsRouter)
  app.use(repoRouter)
  app.use(gitRouter)
  app.use(aiRouter)
  app.use(statsRouter)

  // Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument))

  // Root route with info about the backend
  app.get('/', (req, res) => {
    res.json({
      name: 'DiffX Backend API',
      status: 'running',
      docs: '/api-docs',
      description: 'Provides diffs and backend services for the DiffX application.',
      version: '1.0.0'
    })
  })

  return app
}
