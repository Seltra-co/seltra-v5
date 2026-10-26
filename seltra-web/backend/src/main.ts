//seltra-web/backend/src/main.ts
import { NestFactory } from '@nestjs/core'
import { Logger, ValidationPipe } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import * as bodyParser from 'body-parser'
import type { NextFunction, Request, Response } from 'express'
import { InternalOpsModule } from './internal-ops/internal-ops.module'

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'change-me')) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters in production.')
  }
  const app = await NestFactory.create(AppModule)
  app.getHttpAdapter().getInstance().set('trust proxy', 1)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestedUrl = req.url
    if (/^\/api\/v1(?:\/|\?|$)/.test(requestedUrl)) {
      req.url = requestedUrl.replace(/^\/api\/v1(?=\/|\?|$)/, '/api/v5')
    } else if (/^\/internal\/(?:ops|core)(?:\/|\?|$)/.test(requestedUrl)) {
      req.url = `/api/v5${requestedUrl}`
    }
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=()')
    if (req.url.startsWith('/api/v5/')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    }
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    next()
  })
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))

  //Raise JSON + raw body limits to handle base64 image uploads
  app.use(bodyParser.json({ limit: '15mb' }))
  app.use(bodyParser.urlencoded({ limit: '15mb', extended: true }))

  // Static allowlist for known non-tenant origins (marketing site, admin dashboard, local dev)
  const STATIC_ALLOWED_ORIGINS = new Set([
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:8080',
    'https://seltra.co',
    'https://www.seltra.co',
    'https://seltra-merchant.vercel.app',
    'https://seltra-v5-merchant.vercel.app',
    'https://seltra-v5-merchant-pi.vercel.app',
  ])

  // Matches any merchant storefront subdomain, e.g. https://glow-luxe-skincare.seltra.co
  const TENANT_SUBDOMAIN_REGEX = /^https:\/\/[a-z0-9-]+\.seltra\.co$/
  // Ops dashboard previews (Vercel / Lovable)
  const OPS_ORIGIN_REGEX =
    /^https:\/\/([a-z0-9-]+\.)*(seltra-ops|seltra-ops-platform)([a-z0-9-]*)?\.(vercel\.app|lovable\.app)$/i
  // Local/LAN Next.js (http://192.168.x.x:3000) — needed when testing from Network URL
  const LOCAL_LAN_ORIGIN_REGEX =
    /^http:\/\/(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}):(3000|3001|5173|8080)$/i
  // Merchant marketing / app Vercel previews
  const MERCHANT_VERCEL_ORIGIN_REGEX =
    /^https:\/\/([a-z0-9-]+\.)*(seltra|seltra-merchant|seltra-v5|seltra-v5-merchant)([a-z0-9-]*)?\.vercel\.app$/i

  app.enableCors({
    origin: (origin, callback) => {
      // Requests with no Origin header (server-to-server, curl, Postman, webhooks) — allow
      if (!origin) return callback(null, true)

      const isAllowed =
        STATIC_ALLOWED_ORIGINS.has(origin) ||
        TENANT_SUBDOMAIN_REGEX.test(origin) ||
        OPS_ORIGIN_REGEX.test(origin) ||
        LOCAL_LAN_ORIGIN_REGEX.test(origin) ||
        MERCHANT_VERCEL_ORIGIN_REGEX.test(origin)

      if (isAllowed) {
        return callback(null, true)
      }

      logger.warn(`Blocked CORS request from origin: ${origin}`)
      // Do not throw — Nest maps Error callbacks to HTTP 500; false is enough to deny.
      return callback(null, false)
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

  app.setGlobalPrefix('api/v5')

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
  logger.log(`Health endpoint: ${baseUrl}/api/v5/health`)
  logger.log(`Internal ops Swagger: ${baseUrl}/internal/docs`)
  logger.log(`[Config] SELTRA_HERO_SECONDARY_CARD = ${process.env.SELTRA_HERO_SECONDARY_CARD}`)
  logger.log(`Keep-alive cron: self-ping every 14 minutes`)
}

bootstrap()
