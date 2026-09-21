import { IsEnum, IsOptional, IsString } from 'class-validator'
import { MerchantStatus } from '@prisma/client'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { PaginationDto } from './pagination.dto'

export class ApplicationsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter applications by review status.',
    enum: MerchantStatus,
    example: MerchantStatus.pending,
  })
  @IsOptional()
  @IsEnum(MerchantStatus)
  status?: MerchantStatus

  @ApiPropertyOptional({
    description: 'Case-insensitive search across owner name, business name, store name, and email.',
    example: 'ama',
  })
  @IsOptional()
  @IsString()
  search?: string
}
