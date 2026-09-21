//seltra-web/backend/src/store/store.controller.ts
import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Sse } from '@nestjs/common'
import { StoreService } from './store.service'
import { BuildEventsService } from './build-events.service'
import { planFromPrompt } from '../ai/agents/business-planner.agent'

class PlannerAnswersDto {
  fulfillment_mode?: string
  contact_number?: string
  delivery_tiers?: string
  product_variants?: string
}

class CreateStoreDto {
  name!: string
  businessType?: string
  targetAudience?: string
  prompt!: string
  plannerAnswers?: PlannerAnswersDto
  requestedProductCount?: number
  requestedCategories?: string[]
}

class UpdateStoreDto {
  name?: string
  businessType?: string
  targetAudience?: string
  region?: string
  country?: string
  language?: string
  dismissedAnnouncements?: string[]
  payoutMethod?: string
  payoutProvider?: string
  payoutProviderCode?: string
  payoutAccount?: string
  fulfillmentMode?: string
  contactPhone?: string
  pickupAddress?: string
  pickupInstructions?: string
  deliveryDays?: string
  deliveryEstimate?: string
  deliveryFeeNote?: string
  deliveryTiers?: Array<{
    id: string
    label: string
    description: string
    priceFrom: number
    currency: string
    areas?: string[]
    etaLabel?: string
  }> | null
}

class UpdateFulfillmentDto {
  fulfillmentMode?: string
  contactPhone?: string
  pickupAddress?: string
  pickupInstructions?: string
  deliveryDays?: string
  deliveryEstimate?: string
  deliveryFeeNote?: string
  deliveryTiers?: Array<{
    id: string
    label: string
    description: string
    priceFrom: number
    currency: string
    areas?: string[]
    etaLabel?: string
  }> | null
}

@Controller('seltra/store')
export class StoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly buildEvents: BuildEventsService,
  ) {}

  @Post()
  async create(@Body() body: CreateStoreDto, @Headers('authorization') authorization?: string) {
    const store = await this.storeService.create(body, authorization)
    return { store }
  }

  @Post('build')
  @HttpCode(202)
  startBuild(@Body() body: CreateStoreDto, @Headers('authorization') authorization?: string) {
    const ctx = this.buildEvents.createSession()
    ctx.emit({ type: 'log', message: `Build session ${ctx.buildId} started.` })
    this.storeService.create(body, authorization, ctx)
      .then((store) => {
        return this.storeService.findByIdOrSlug(store.id ?? store.slug)
      })
      .then((freshStore) => {
        ctx.emit({ type: 'preview', url: freshStore.storeUrl ?? `${freshStore.slug}.seltra.co`, store: freshStore })
        ctx.emit({ type: 'done', store: freshStore })
      })
      .catch((error) => {
        ctx.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return { buildId: ctx.buildId }
  }

  @Post('plan')
  async plan(@Body() body: { prompt: string }) {
    if (!body?.prompt?.trim()) throw new BadRequestException('Prompt is required')
    return planFromPrompt(body.prompt)
  }

  @Get('check-limit')
  async checkLimit(@Headers('authorization') authorization?: string) {
    const result = await this.storeService.checkStoreCreationLimit(authorization)
    return result
  }

  @Sse('build/:id/events')
  streamBuild(@Param('id') id: string) {
    return this.buildEvents.stream(id)
  }

  @Get()
  async findMine(@Headers('authorization') authorization?: string) {
    const stores = await this.storeService.findMine(authorization)
    return stores.map((s) => ({
      ...s,
      storefrontCode: s.storefrontCode ?? null,
      storefrontVersion: s.storefrontVersion ?? 0,
      manifest: s.manifest ?? null,
      heroSource: s.heroSource ?? null,
      navSource: s.navSource ?? null,
    }))
  }

  @Get(':slug')
  async findOne(@Param('slug') slug: string) {
    const store = await this.storeService.findBySlug(slug)
    return {
      ...store,
      storefrontCode: store.storefrontCode ?? null,
      storefrontVersion: store.storefrontVersion ?? 0,
      manifest: store.manifest ?? null,
      heroSource: store.heroSource ?? null,
      navSource: store.navSource ?? null,
    }
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateStoreDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.storeService.update(id, body, authorization)
  }

  // Dedicated endpoint merchants hit from Settings to fill in / edit
  // delivery-day copy, pickup address, or switch fulfillment mode after
  // the store's already live — not just at creation time.
  @Patch(':id/fulfillment')
  updateFulfillment(
    @Param('id') id: string,
    @Body() body: UpdateFulfillmentDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.storeService.update(id, body, authorization)
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.storeService.delete(id, authorization)
  }

  @Post(':id/regenerate')
  @HttpCode(200)
  async regenerateStorefront(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.storeService.regenerateStorefrontCodeForOwner(id, authorization)
    return { success: true, message: 'Storefront regeneration queued' }
  }
}
