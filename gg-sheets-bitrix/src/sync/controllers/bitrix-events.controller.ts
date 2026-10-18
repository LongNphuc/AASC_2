import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { API_DOC } from '../../common/constants/messages.constant';
import { BitrixEventService } from '../services/bitrix-event.service';

/**
 * POST /webhooks/bitrix24: Bitrix24 gọi khi lead thay đổi (webhook đi). Công
 * khai vì Bitrix24 không gửi được x-api-key; request được xác thực bằng
 * auth[application_token] so với BITRIX24_OUTBOUND_TOKEN.
 */
@ApiTags(API_DOC.WEBHOOK.TAG)
@Controller('webhooks')
export class BitrixEventsController {
  constructor(private readonly events: BitrixEventService) {}

  @Public()
  @Post('bitrix24')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: API_DOC.WEBHOOK.BITRIX })
  receive(@Body() body: Record<string, unknown>) {
    return this.events.handle(body);
  }
}
