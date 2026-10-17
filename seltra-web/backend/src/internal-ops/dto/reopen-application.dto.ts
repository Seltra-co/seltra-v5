import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class ReopenApplicationDto {
  @ApiPropertyOptional({
    description: 'Updated owner full name.',
    maxLength: 120,
    example: 'Jerry Richman',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string

  @ApiPropertyOptional({
    description: 'Updated business name.',
    maxLength: 120,
    example: "Jay's Tech",
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  businessName?: string

  @ApiPropertyOptional({
    description: 'Updated store display name.',
    maxLength: 120,
    example: "Jay's Tech",
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  storeName?: string

  @ApiPropertyOptional({
    description: 'Updated business category.',
    maxLength: 80,
    example: 'Other',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessType?: string

  @ApiPropertyOptional({
    description: 'Updated phone number.',
    maxLength: 40,
    example: '0545549845',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string

  @ApiPropertyOptional({
    description: 'Updated location.',
    maxLength: 120,
    example: 'Accra, Ghana',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  basedIn?: string

  @ApiPropertyOptional({
    description: 'Updated description of what the merchant sells.',
    maxLength: 2000,
    example: 'Phones, accessories, and tech repairs',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  whatYouSell?: string

  @ApiPropertyOptional({
    description: 'Updated monthly revenue band.',
    maxLength: 80,
    example: 'Under GHS 5,000',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  monthlyRevenue?: string
}
