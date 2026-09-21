// merchants-messaging-response.dto.ts
import { ApiProperty } from '@nestjs/swagger'

export class MerchantMessagingContactDto {
  @ApiProperty({ example: 'b7cf0dc7-7757-4a07-8a5e-c06d0193dc10' })
  id: string

  @ApiProperty({ example: 'William Ofosu-Parwar' })
  fullName: string

  @ApiProperty({ example: 'William Store' })
  storeName: string

  @ApiProperty({ example: 'williamofosuparwar@gmail.com' })
  email: string

  @ApiProperty({ example: '0558288424', nullable: true })
  phoneNumber: string | null
}

export class MerchantsMessagingListResponseDto {
  @ApiProperty({ example: true })
  success: boolean

  @ApiProperty({ example: 'Fetched merchants for messaging successfully.' })
  message: string

  @ApiProperty({ type: [MerchantMessagingContactDto] })
  data: MerchantMessagingContactDto[]
}

export class MerchantMessagingResponseDto {
  @ApiProperty({ example: true })
  success: boolean

  @ApiProperty({ example: 'Fetched merchant for messaging successfully.' })
  message: string

  @ApiProperty({ type: MerchantMessagingContactDto, nullable: true })
  data: MerchantMessagingContactDto | null
}