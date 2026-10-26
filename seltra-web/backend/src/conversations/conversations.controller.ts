//backend/src/conversations/conversations.controller.ts
import { Body, Controller, Delete, Get, Headers, Param, Post, Query } from '@nestjs/common'
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'
import { ConversationsService } from './conversations.service'

class CreateConversationDto {
  @IsString()
  @MaxLength(60)
  title!: string
}

class CreateMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant'

  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  content!: string
}

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(@Headers('authorization') authorization?: string, @Query('order') order?: string) {
    return this.conversationsService.list(authorization, order)
  }

  @Post()
  create(@Body() body: CreateConversationDto, @Headers('authorization') authorization?: string) {
    return this.conversationsService.create(body.title, authorization)
  }

  @Get(':id/messages')
  messages(@Param('id') id: string) {
    return this.conversationsService.messages(id)
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.conversationsService.delete(id, authorization)
  }

  @Post(':id/messages')
  createMessage(
    @Param('id') id: string,
    @Body() body: CreateMessageDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.conversationsService.createMessage(id, body, authorization)
  }
}
