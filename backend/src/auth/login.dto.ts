import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  username!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(512)
  password!: string;
}
