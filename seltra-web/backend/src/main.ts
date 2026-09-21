//seltra-web/backend/src/main.ts
import { NestFactory } from '@nestjs/core'
import { Logger, RequestMethod } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import * as bodyParser from 'body-parser'
import { InternalOpsModule } from './internal-ops/internal-ops.module'

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  const app = await NestFactory.create(AppModule)

  //Raise JSON + raw body limits to handle base64 image uploads
  app.use(bodyParser.json({ limit: '15mb' }))
  app.use(bodyParser.urlencoded({ limit: '15mb', extended: true }))

  // Static allowlist for known non-tenant origins (marketing site, admin dashboard, local dev)
  const STATIC_ALLOWED_ORIGINS = new Set([
    'http://localhost:3000',
    'https://seltra.co',
    'https://www.seltra.co',
    'https://seltra-merchant.vercel.app',
  ])

  // Matches any merchant storefront subdomain, e.g. https://glow-luxe-skincare.seltra.co
  const TENANT_SUBDOMAIN_REGEX = /^https:\/\/[a-z0-9-]+\.seltra\.co$/

  app.enableCors({
    origin: (origin, callback) => {
      // Requests with no Origin header (server-to-server, curl, Postman, webhooks) — allow
      if (!origin) return callback(null, true)

      const isAllowed =
        STATIC_ALLOWED_ORIGINS.has(origin) || TENANT_SUBDOMAIN_REGEX.test(origin)

      if (isAllowed) {
        return callback(null, true)
      }

      logger.warn(`Blocked CORS request from origin: ${origin}`)
      return callback(new Error('Not allowed by CORS'), false)
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-internal-api-key',
      'x-ops-actor',
    ],
    credentials: true,
  })

  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'internal/ops', method: RequestMethod.ALL },
      { path: 'internal/ops/(.*)', method: RequestMethod.ALL },
    ],
  })

  // Graceful shutdown
  app.enableShutdownHooks()

  /**
   * ------------------------------------
   * Swagger Configuration
   * ------------------------------------
   */
  // const config = new DocumentBuilder()
  //   .setTitle('Seltra API')
  //   .setDescription(
  //     'Official API documentation for the Seltra commerce platform.',
  //   )
  //   .setVersion('1.0.0')
  //   .addServer(
  //     'http://localhost:3001',
  //     'Local Development',
  //   )
  //   .addServer(
  //     'https://api.seltra.co',
  //     'Production',
  //   )
  //   .addBearerAuth(
  //     {
  //       type: 'http',
  //       scheme: 'bearer',
  //       bearerFormat: 'JWT',
  //     },
  //     'access-token',
  //   )
  //   .build()

  const opsConfig = new DocumentBuilder()
    .setTitle('Seltra Internal Ops API')
    .setDescription('Official internal operations API documentation for Seltra merchant and ops network communication.')
    .setVersion('1.0.0')
    .addServer(
      'http://localhost:3001',
      'Local Development',
    )
    .addServer(
      'https://seltra-merchant-backend.onrender.com',
      'Production',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-internal-api-key',
        in: 'header',
        description: 'Internal ops API key. The guard accepts the current or previous key from the server environment.',
      },
      'internal-api-key',
    )
    .build()

  // const document = SwaggerModule.createDocument(app, config)
  // SwaggerModule.setup('api/docs', app, document)

  const opsDocument = SwaggerModule.createDocument(app, opsConfig, {
    include: [
      InternalOpsModule,
    ],
  })

  SwaggerModule.setup('internal/docs', app, opsDocument)

  const port = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : 3001

  await app.listen(port)

  const baseUrl =
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${port}`

  logger.log(`Seltra API is running on port ${port}`)
  logger.log(`Health endpoint: ${baseUrl}/api/v1/health`)
  logger.log(`Internal ops Swagger: ${baseUrl}/internal/docs`)
  logger.log(`[Config] SELTRA_HERO_SECONDARY_CARD = ${process.env.SELTRA_HERO_SECONDARY_CARD}`)
  logger.log(`Keep-alive cron: self-ping every 14 minutes`)
}

bootstrap()