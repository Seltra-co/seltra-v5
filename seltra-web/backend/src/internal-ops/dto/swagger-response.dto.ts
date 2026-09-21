import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class OpsErrorResponseDto {
  @ApiProperty({ example: 401 })
  statusCode!: number

  @ApiProperty({ example: 'Unauthorized' })
  message!: string

  @ApiPropertyOptional({ example: 'Unauthorized' })
  error?: string
}

export class MoneyResponseDto {
  @ApiProperty({ description: 'Decimal amount serialized as a fixed two-decimal string.', example: '1200.00' })
  amount!: string

  @ApiProperty({ example: 'GHS' })
  currency!: string
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number

  @ApiProperty({ example: 20 })
  pageSize!: number

  @ApiProperty({ example: 42 })
  total!: number

  @ApiProperty({ example: 3 })
  totalPages!: number
}

export class HealthResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean

  @ApiProperty({ example: 'seltra-merchant-backend' })
  service!: string

  @ApiProperty({ example: '2026-07-09T12:34:56.000Z' })
  time!: string
}

export class DashboardOverviewResponseDto {
  @ApiProperty({ example: 128 })
  totalMerchantsStores!: number

  @ApiProperty({ example: 96 })
  activeMerchantsStores!: number

  @ApiProperty({ type: MoneyResponseDto })
  gmv30d!: MoneyResponseDto

  @ApiProperty({ example: 340 })
  paidOrders30d!: number

  @ApiProperty({ example: 18 })
  waitlistApplicants!: number

  @ApiProperty({ example: 4 })
  approvedToOnboard!: number

  @ApiProperty({ example: 74 })
  merchantSuccess!: number

  @ApiProperty({ example: 52 })
  aiInvocations24h!: number
}

export class CityFootprintDto {
  @ApiProperty({ example: 'Accra' })
  city!: string

  @ApiProperty({ example: 12 })
  count!: number
}

export class CountryFootprintDto {
  @ApiProperty({ example: 'Ghana' })
  country!: string

  @ApiProperty({ example: 22 })
  count!: number

  @ApiProperty({ type: [CityFootprintDto] })
  cities!: CityFootprintDto[]
}

export class DashboardFootprintResponseDto {
  @ApiProperty({ example: 128 })
  totalMerchants!: number

  @ApiProperty({ example: 74 })
  activeMerchants!: number

  @ApiProperty({ type: [CountryFootprintDto] })
  countries!: CountryFootprintDto[]

  @ApiPropertyOptional({ example: 'Ghana', nullable: true })
  topMarket!: string | null
}

export class GmvSeriesPointDto {
  @ApiProperty({ example: '2026-07-09' })
  date!: string

  @ApiProperty({ type: MoneyResponseDto })
  gmv!: MoneyResponseDto

  @ApiProperty({ example: 14 })
  orders!: number
}

export class ActivitySeriesPointDto {
  @ApiProperty({ example: '2026-07-09' })
  date!: string

  @ApiProperty({ example: 31 })
  count!: number
}

export class TopMerchantDto {
  @ApiProperty({ example: 1 })
  rank!: number

  @ApiProperty({ example: 'clx9tenant123' })
  tenantId!: string

  @ApiProperty({ example: 'Glow Circle Beauty' })
  name!: string

  @ApiPropertyOptional({ example: 'glow-circle-beauty', nullable: true })
  slug!: string | null

  @ApiProperty({ type: MoneyResponseDto })
  gmv!: MoneyResponseDto
}

export class TopMerchantsResponseDto {
  @ApiProperty({ example: '30days' })
  period!: string

  @ApiProperty({ example: false })
  fallback!: boolean

  @ApiProperty({ type: [TopMerchantDto] })
  data!: TopMerchantDto[]
}

export class RecentEventDto {
  @ApiProperty({ example: 'clx9event123' })
  id!: string

  @ApiProperty({ example: 'payment_received' })
  type!: string

  @ApiProperty({ example: 'glow-circle-beauty' })
  tenantSlug!: string

  @ApiProperty({ example: '4h ago' })
  howLongAgo!: string

  @ApiProperty({ type: Object, nullable: true, example: { orderId: 'ord_123' } })
  meta!: unknown

  @ApiProperty({ example: '2026-07-09T12:34:56.000Z' })
  createdAt!: string
}

export class EmptyMessageResponseDto {
  @ApiProperty({ example: 'No recent events found' })
  message!: string
}

export class ComponentStatusDto {
  @ApiProperty({ enum: ['healthy', 'degraded'], example: 'healthy' })
  status!: 'healthy' | 'degraded'

  @ApiPropertyOptional({ example: '2026-07-09T12:34:56.000Z' })
  lastCheckedAt?: string

  @ApiPropertyOptional({ example: 'no payment_received event in 24h' })
  reason?: string

  @ApiPropertyOptional({ example: 42 })
  latencyMs?: number
}

export class SystemStatusResponseDto {
  @ApiProperty({ type: ComponentStatusDto })
  api!: ComponentStatusDto

  @ApiProperty({ type: ComponentStatusDto })
  agent!: ComponentStatusDto

  @ApiProperty({ type: ComponentStatusDto })
  storefront!: ComponentStatusDto

  @ApiProperty({ type: ComponentStatusDto })
  payments!: ComponentStatusDto

  @ApiProperty({ type: ComponentStatusDto })
  db!: ComponentStatusDto
}

export class RecentMerchantApplicationDto {
  @ApiProperty({ example: 'clx9app123' })
  id!: string

  @ApiProperty({ example: 'Ama Mensah' })
  fullName!: string

  @ApiProperty({ example: 'Glow Circle Ltd' })
  businessName!: string

  @ApiProperty({ example: 'Glow Circle Beauty' })
  storeName!: string

  @ApiProperty({ example: 'pending' })
  status!: string
}

export class MerchantApplicationDto {
  @ApiProperty({ example: 'clx9app123' })
  id!: string

  @ApiProperty({ example: 'Ama Mensah' })
  ownerName!: string

  @ApiProperty({ example: 'ama@example.com' })
  ownerEmail!: string

  @ApiProperty({ example: 'Glow Circle Ltd' })
  businessName!: string

  @ApiProperty({ example: 'Beauty' })
  businessType!: string

  @ApiProperty({ example: 'pending' })
  status!: string

  @ApiProperty({ example: '2026-07-09T12:34:56.000Z' })
  appliedAt!: string
}

export class ApplicationsListResponseDto extends PaginationMetaDto {
  @ApiProperty({ type: [MerchantApplicationDto] })
  data!: MerchantApplicationDto[]
}

export class ApplicationApprovalResponseDto {
  @ApiProperty({ example: 'clx9app123' })
  applicationId!: string

  @ApiProperty({ example: 'SELTRA-1234-5678' })
  merchantId!: string

  @ApiProperty({ example: 'ama@example.com' })
  email!: string

  @ApiProperty({ example: 'approved' })
  status!: string

  @ApiProperty({ example: true })
  credentialsSent!: boolean
}

export class ApplicationRejectionResponseDto {
  @ApiProperty({ example: 'clx9app123' })
  applicationId!: string

  @ApiProperty({ example: 'rejected' })
  status!: string
}

export class MerchantRowDto {
  @ApiProperty({ example: 'clx9tenant123' })
  tenantId!: string

  @ApiProperty({ example: 'Glow Circle Beauty' })
  storeName!: string

  @ApiProperty({ example: 'glow-circle-beauty' })
  slug!: string

  @ApiPropertyOptional({ example: 'Ama Mensah', nullable: true })
  ownerName!: string | null

  @ApiPropertyOptional({ example: 'ama@example.com', nullable: true })
  ownerEmail!: string | null

  @ApiProperty({ example: 'Beauty' })
  businessType!: string

  @ApiProperty({ example: 'active' })
  status!: string

  @ApiProperty({ type: MoneyResponseDto })
  gmv!: MoneyResponseDto

  @ApiProperty({ example: 42 })
  orderCount!: number

  @ApiPropertyOptional({ example: 'today', nullable: true })
  lastActive!: string | null

  @ApiProperty({ example: '2026-07-09T12:34:56.000Z' })
  joinedAt!: string
}

export class MerchantsListResponseDto extends PaginationMetaDto {
  @ApiProperty({ type: [MerchantRowDto] })
  data!: MerchantRowDto[]
}

export class MerchantDetailDto {
  @ApiProperty({ example: 'clx9tenant123' })
  tenantId!: string

  @ApiProperty({ example: 'Glow Circle Beauty' })
  storeName!: string

  @ApiPropertyOptional({ example: 'Ama Mensah', nullable: true })
  ownerName!: string | null

  @ApiPropertyOptional({ example: 'ama@example.com', nullable: true })
  ownerEmail!: string | null

  @ApiProperty({ example: 'Beauty' })
  businessType!: string

  @ApiPropertyOptional({ example: 'Accra, Ghana', nullable: true })
  basedIn!: string | null
}

export class MerchantDetailResponseDto {
  @ApiProperty({ type: MerchantDetailDto })
  data!: MerchantDetailDto
}

export class MerchantRemovalResponseDto {
  @ApiProperty({ example: 'clx9tenant123' })
  tenantId!: string

  @ApiProperty({ example: 'removed' })
  status!: string
}
