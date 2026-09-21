
// import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common'
// import { Response } from 'express'
// import { PaymentService } from './payment.service'
// import type { MoolreWebhookBody } from './moolre.service'

// @Controller('webhooks/moolre')
// export class MoolreWebhookController {
//   constructor(private readonly paymentService: PaymentService) {}

//   @Post()
//   @HttpCode(200)
//   handle(@Body() body: MoolreWebhookBody) {
//     return this.paymentService.handleMoolreWebhook(body)
//   }

//   @Get()
//   redirect(
//     @Query('status') status: string,
//     @Query('reference') reference: string,
//     @Res() res: Response,
//   ) {
//     // reference format: seltra_{slug}_{timestamp}_{rand}
//     // slug may contain hyphens but NOT underscores (generateReference uses tenant.slug)
//     // So: drop first segment "seltra", drop last two segments (ts + rand), rejoin remainder
//     const parts = (reference ?? '').split('_')
//     // parts: ["seltra", ...slugParts..., "1782492502871", "d5a8d542"]
//     const slug = parts.length >= 4 ? parts.slice(1, -2).join('_') : ''

//     const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')

//     console.log(`[Moolre] Redirect GET: status=${status} reference=${reference} slug=${slug}`)

//     if (status === 'success' && reference) {
//       return res.redirect(
//         `${frontendBase}/store/${slug}/order/success?reference=${encodeURIComponent(reference)}`,
//       )
//     }

//     return res.redirect(
//       `${frontendBase}/store/${slug}/order/failed?reference=${encodeURIComponent(reference ?? '')}`,
//     )
//   }
// }

import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common'
import { Response } from 'express'
import { PaymentService } from './payment.service'
import type { MoolreWebhookBody } from './moolre.service'

const ROOT_DOMAIN = process.env.SELTRA_ROOT_DOMAIN || 'seltra.co'

@Controller('webhooks/moolre')
export class MoolreWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @HttpCode(200)
  handle(@Body() body: MoolreWebhookBody) {
    return this.paymentService.handleMoolreWebhook(body)
  }

  @Get()
  redirect(
    @Query('status') status: string,
    @Query('reference') reference: string,
    @Res() res: Response,
  ) {
    // reference format: seltra_{slug}_{timestamp}_{rand}
    // slug may contain hyphens but NOT underscores (generateReference uses tenant.slug)
    // So: drop first segment "seltra", drop last two segments (ts + rand), rejoin remainder
    const parts = (reference ?? '').split('_')
    const slug = parts.length >= 4 ? parts.slice(1, -2).join('_') : ''

    const rawFrontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')
    const isLocalDev = /^https?:\/\/localhost(:\d+)?$/.test(rawFrontendUrl)

    // Production: Cloudflare Worker proxies {slug}.seltra.co -> vercel /store/{slug}
    // transparently, so the redirect target here must be the bare subdomain path
    // with NO /store/{slug} prefix — the Worker adds that itself.
    // Local dev: no wildcard subdomain DNS, so hit the Next.js /store/{slug} route directly.
    const targetOrigin = isLocalDev || !slug
      ? rawFrontendUrl
      : `https://${slug}.${ROOT_DOMAIN}`
    const targetPathPrefix = isLocalDev ? `/store/${slug}` : ''

    console.log(`[Moolre] Redirect GET: status=${status} reference=${reference} slug=${slug} target=${targetOrigin}${targetPathPrefix}`)

    if (status === 'success' && reference) {
      return res.redirect(
        `${targetOrigin}${targetPathPrefix}/order/success?reference=${encodeURIComponent(reference)}`,
      )
    }

    return res.redirect(
      `${targetOrigin}${targetPathPrefix}/order/failed?reference=${encodeURIComponent(reference ?? '')}`,
    )
  }
}