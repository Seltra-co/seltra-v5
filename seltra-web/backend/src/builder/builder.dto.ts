import { IsInt, IsOptional, IsString, IsUrl, IsIn, Min, IsObject, IsBoolean, MaxLength } from 'class-validator'

export class BuilderSessionDto {
  @IsString()
  tenantId!: string

  @IsOptional()
  @IsString()
  coreToken?: string
}

export class BuilderIntentDto {
  @IsString()
  prompt!: string
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
  @IsIn(['draft', 'planning', 'awaiting_answers', 'building', 'preview_ready', 'published', 'live', 'failed', 'stopped'])
  status?: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  previewUrl?: string

  @IsOptional()
  @IsString()
  eventType?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  workspaceInstanceId?: string

  @IsOptional()
  @IsString()
  runId?: string

  @IsOptional()
  @IsString()
  errorCode?: string

  @IsOptional()
  @IsString()
  errorDetail?: string

  @IsOptional()
  @IsObject()
  blueprint?: Record<string, unknown>

  @IsOptional()
  @IsBoolean()
  approved?: boolean
}
