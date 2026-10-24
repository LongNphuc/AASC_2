import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { API_DOC } from '../../common/constants/messages.constant';
import { BitrixMetadataService } from '../services/bitrix-metadata.service';

@ApiTags('Bitrix24')
@Controller('api/v1/bitrix')
export class BitrixController {
  constructor(private readonly metadata: BitrixMetadataService) {}

  /** Mã, tên hiển thị, kiểu, bắt buộc, chỉ đọc của mọi field lead (để viết mapping). */
  @Get('lead-fields')
  @ApiOperation(API_DOC.BITRIX.LEAD_FIELDS)
  async leadFields() {
    const fields = await this.metadata.leadFields();
    return Object.entries(fields).map(([code, field]) => ({
      code,
      title: field.formLabel ?? field.listLabel ?? field.title ?? code,
      type: field.type,
      isRequired: !!field.isRequired,
      isReadOnly: !!field.isReadOnly,
      isMultiple: !!field.isMultiple,
    }));
  }
}
