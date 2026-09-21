import { IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class MerchantPatchDto {
  @ApiPropertyOptional({
    description: 'Updated store display name.',
    maxLength: 120,
    example: 'Glow Circle Beauty',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string

  @ApiPropertyOptional({
    description: 'Updated merchant business category.',
    maxLength: 80,
    example: 'Beauty',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessType?: string

  @ApiPropertyOptional({
    description: 'Updated tenant status.',
    maxLength: 40,
    example: 'active',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string

  @ApiPropertyOptional({
    description: 'Updated owner application location.',
    maxLength: 80,
    example: 'Accra, Ghana',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  basedIn?: string
}
