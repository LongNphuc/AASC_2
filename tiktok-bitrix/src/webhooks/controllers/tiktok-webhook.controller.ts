import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { API_DOC } from '../../common/constants/messages.constant';
import { TikTokSignatureGuard } from '../guards/tiktok-signature.guard';
import { parseTiktokBody, pickHeaders } from '../helpers/webhook-body';
import { TIKTOK_SIGNATURE_HEADER } from '../helpers/tiktok-signature';
import {
  WebhookIntakeService,
  type TiktokAcceptResult,
} from '../services/webhook-intake.service';
import { TIKTOK_LEAD_EXAMPLE } from '../dto/webhook-examples';

/**
 * POST /webhooks/tiktok/leads: kiểm chữ ký, lưu raw, đẩy job, trả 200 trong
 * vài mili giây (readme_design.md mục 3.2). Body đọc dạng Buffer (api.module.ts)
 * để kiểm chữ ký trên đúng từng byte TikTok gửi, rồi mới parse JSON.
 */
@ApiTags('Webhooks')
@Controller('webhooks/tiktok')
export class TiktokWebhookController {
  constructor(private readonly intake: WebhookIntakeService) {}

  @Post('leads')
  @Public()
  @HttpCode(200)
  @UseGuards(TikTokSignatureGuard)
  @ApiOperation(API_DOC.WEBHOOK.TIKTOK)
  @ApiHeader({
    name: TIKTOK_SIGNATURE_HEADER,
    required: true,
    description: API_DOC.WEBHOOK.SIGNATURE_HEADER,
  })
  @ApiBody({
    schema: { type: 'object', example: TIKTOK_LEAD_EXAMPLE },
  })
  @ApiOkResponse({
    schema: { example: { received: true, eventId: 'evt_1234567890' } },
  })
  receive(@Req() request: Request): Promise<TiktokAcceptResult> {
    const body = parseTiktokBody(
      Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
    );
    return this.intake.acceptTiktok(body, pickHeaders(request));
  }
}
