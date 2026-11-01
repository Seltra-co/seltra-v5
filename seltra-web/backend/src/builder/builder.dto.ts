import { IsInt, IsOptional, IsString, IsUrl, IsIn, Min, IsObject, IsBoolean } from 'class-validator'

export class BuilderSessionDto {
  @IsString()
  tenantId!: string
}

export class SyncTenantAppDto {
  @IsString()
  tenantId!: string

  @IsInt()
  @Min(1)
  coreAppId!: number

  @IsString()
  name!: string

  @IsOptional()
  @IsString()
  corePath?: string

  @IsIn(['draft', 'building', 'live', 'failed'])
  status!: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  previewUrl?: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  publishedUrl?: string

  @IsOptional()
  @IsString()
  lastCommitSha?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number
}

export class SyncCoreAppStateDto {
  @IsString()
  tenantId!: string

  @IsInt()
  @Min(1)
  coreAppId!: number

  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  corePath?: string

  @IsOptional()
  @IsIn(['draft', 'building', 'live', 'failed'])
  status?: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  previewUrl?: string

  @IsOptional()
  @IsString()
  eventType?: string

  @IsOptional()
  @IsObject()
  blueprint?: Record<string, unknown>

  @IsOptional()
  @IsBoolean()
  approved?: boolean
}
