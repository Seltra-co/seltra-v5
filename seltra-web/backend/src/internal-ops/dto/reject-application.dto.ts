import { IsString, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class RejectApplicationDto {
  @ApiProperty({
    description: 'Reason recorded for rejecting the merchant application.',
    minLength: 3,
    example: 'Business information could not be verified.',
  })
  @IsString()
  @MinLength(3)
  reason!: string
}
