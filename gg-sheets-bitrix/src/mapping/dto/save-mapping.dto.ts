import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, Min } from 'class-validator';

/** Body của PUT /mapping. */
export class SaveMappingDto {
  @ApiProperty({
    description: 'Phiên bản đang sửa; đã có bản mới hơn thì trả 409',
    example: 3,
  })
  @IsInt()
  @Min(0)
  baseVersion: number;

  @ApiProperty({
    description: 'Nội dung mapping',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  mappingJson: Record<string, unknown>;
}
