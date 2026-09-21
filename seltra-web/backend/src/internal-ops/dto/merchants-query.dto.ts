import { Transform } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { PaginationDto } from './pagination.dto'

export class MerchantsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive search across store name, slug, and owner email.',
    example: 'glow',
  })
  @IsOptional()
  @IsString()
  search?: string

  @ApiPropertyOptional({
    description: 'Filter merchants by tenant status.',
    example: 'active',
  })
  @IsOptional()
  @IsString()
  status?: string

  @ApiPropertyOptional({
    description: 'Filter merchants by business type.',
    example: 'Beauty',
  })
  @IsOptional()
  @IsString()
  businessType?: string

  @ApiPropertyOptional({
    description: 'Filter merchants by country.',
    example: 'Ghana',
  })
  @IsOptional()
  @IsString()
  country?: string

  @ApiPropertyOptional({
    description: 'Metric used to sort merchant rows.',
    enum: ['gmv', 'orders', 'lastActive', 'joined'],
    default: 'joined',
    example: 'joined',
  })
  @IsOptional()
  @IsIn(['gmv', 'orders', 'lastActive', 'joined'])
  sortBy: 'gmv' | 'orders' | 'lastActive' | 'joined' = 'joined'

  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: ['asc', 'desc'],
    default: 'desc',
    example: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'desc'
}

export class MerchantExportQueryDto extends MerchantsQueryDto {
  pageSize = 100
}

export class TopMerchantsQueryDto {
  @ApiPropertyOptional({
    description: 'Maximum number of merchants to return.',
    default: 5,
    minimum: 1,
    maximum: 20,
    example: 5,
  })
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 5))
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 5

  @ApiPropertyOptional({
    description: 'Optional trailing-day window. If no merchants are found in the window, the service falls back to all-time.',
    minimum: 1,
    maximum: 90,
    example: 30,
  })
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : Number(value))
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number
}
