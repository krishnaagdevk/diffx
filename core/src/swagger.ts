export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'DiffX API',
    version: '1.0.0',
    description: 'API documentation for the DiffX backend',
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Local development server',
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Successful response',
          },
        },
      },
    },
  },
}
