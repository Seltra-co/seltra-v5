import { Transform } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants'

export class PaginationDto {
  @ApiPropertyOptional({
    description: 'One-based page number.',
    default: DEFAULT_PAGE,
    minimum: 1,
    example: 1,
  })
  @IsOptional()
  @Transform(({ value }) => Number(value ?? DEFAULT_PAGE))
  @IsInt()
  @Min(1)
  page = DEFAULT_PAGE

  @ApiPropertyOptional({
    description: 'Number of records to return per page.',
    default: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    example: 20,
  })
  @IsOptional()
  @Transform(({ value }) => Number(value ?? DEFAULT_PAGE_SIZE))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize = DEFAULT_PAGE_SIZE
}

export class DaysDto {
  @ApiPropertyOptional({
    description: 'Number of trailing days to include in the series.',
    default: 30,
    minimum: 1,
    maximum: 90,
    example: 30,
  })
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 30))
  @IsInt()
  @Min(1)
  @Max(90)
  days = 30
}

export class LimitDto {
  @ApiPropertyOptional({
    description: 'Maximum number of records to return.',
    default: 10,
    minimum: 1,
    maximum: 50,
    example: 10,
  })
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 10))
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10
}
