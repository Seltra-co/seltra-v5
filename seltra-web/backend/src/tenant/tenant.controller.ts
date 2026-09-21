//apps/api/src/tenant/tenant.controller.ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { TenantService } from './tenant.service'

class CreateStoreDto {
  name!: string
  businessType?: string
  targetAudience?: string
  prompt!: string
}

class UpdateStoreDto {
  name?: string
  businessType?: string
  targetAudience?: string
  status?: string
  canonical?: Record<string, unknown>
  storeUrl?: string
}

@Controller('legacy/seltra/store')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post()
  async create(@Body() body: CreateStoreDto) {
    const { tenant } = await this.tenantService.createFromPrompt(
      [body.name, body.businessType, body.targetAudience, body.prompt].filter(Boolean).join('\n'),
    )
    return { store: tenant }
  }

  @Get()
  findAll() {
    return this.tenantService.findAll()
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateStoreDto) {
    return this.tenantService.update(id, body)
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.tenantService.findBySlug(slug)
  }
}
