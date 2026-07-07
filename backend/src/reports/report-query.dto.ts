import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const toBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
};

export class ReportQueryDto {
  @ApiProperty({
    description: 'Comma-separated branch IDs. Selected branches are queried sequentially.',
    example: '29,31',
  })
  @IsString()
  @MaxLength(2048)
  @Matches(/^[A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*$/)
  branchIds!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page = 1;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  returned?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  voided?: boolean;

  @ApiPropertyOptional({ enum: ['earned', 'redeemed', 'any'] })
  @IsOptional()
  @IsIn(['earned', 'redeemed', 'any'])
  points?: 'earned' | 'redeemed' | 'any';

  @ApiPropertyOptional({
    enum: ['returnedOrVoided', 'returned', 'voided', 'all'],
    default: 'returnedOrVoided',
  })
  @IsOptional()
  @IsIn(['returnedOrVoided', 'returned', 'voided', 'all'])
  exception: 'returnedOrVoided' | 'returned' | 'voided' | 'all' =
    'returnedOrVoided';
}

export class ExportQueryDto extends ReportQueryDto {
  @IsOptional()
  page = 1;

  @IsOptional()
  pageSize = 100;
}

export class ReceiptQueryDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  branchId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  transactionNo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/)
  terminalNo?: string;
}
