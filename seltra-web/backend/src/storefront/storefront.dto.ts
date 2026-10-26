import { Type } from 'class-transformer'
import { IsArray, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator'

export class StorefrontLineDto {
  @IsString()
  productId!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number
}

export class StorefrontCheckoutDto {
  @IsEmail()
  @MaxLength(254)
  customerEmail!: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  customerPhone?: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StorefrontLineDto)
  items!: StorefrontLineDto[]

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  callbackUrl?: string
}

export class StorefrontConfirmDto {
  @IsString()
  @MaxLength(200)
  reference!: string
}
