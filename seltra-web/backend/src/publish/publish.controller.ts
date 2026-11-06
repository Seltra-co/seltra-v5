import { Controller, Get, Headers, Param, Query } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { IsInt, IsOptional, IsString, Min } from 'class-validator'
import { resolveUserIdFromAuthorization } from '../auth/resolve-user'
import { PublishService } from './publish.service'

class PublishAppQuery {
  @IsString() appId!: string
}

class PublishHistoryQuery {
  @IsString() appId!: string
  @IsOptional() @IsInt() @Min(1) limit?: number
  @IsOptional() @IsString() cursor?: string
}

class PublishEventQuery {
  @IsOptional() @IsInt() @Min(0) sinceSeq?: number
}

@Controller('seltra/store/publish')
export class PublishController {
  constructor(private readonly publish: PublishService, private readonly jwt: JwtService) {}

  private userId(authorization: string | undefined) {
    return resolveUserIdFromAuthorization(authorization, this.jwt)
  }

  @Get('status')
  async status(@Headers('authorization') authorization: string | undefined, @Query() query: PublishAppQuery) {
    return this.publish.status(await this.userId(authorization) as string, query.appId)
  }

  @Get('deployments')
  async deployments(@Headers('authorization') authorization: string | undefined, @Query() query: PublishHistoryQuery) {
    return this.publish.deployments(await this.userId(authorization) as string, query.appId, query.limit, query.cursor)
  }

  @Get('deployments/:id')
  async deployment(@Headers('authorization') authorization: string | undefined, @Param('id') id: string, @Query() query: PublishEventQuery) {
    return this.publish.deployment(await this.userId(authorization) as string, id, query.sinceSeq)
  }
}
