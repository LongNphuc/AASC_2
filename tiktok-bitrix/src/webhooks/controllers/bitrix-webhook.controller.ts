import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { API_DOC } from '../../common/constants/messages.constant';
import { BitrixTokenGuard } from '../guards/bitrix-token.guard';
import { WebhookIntakeService } from '../services/webhook-intake.service';

/**
 * POST /webhooks/bitrix24/deals: Bitrix24 báo deal đổi stage hoặc bị xóa,
 * dạng form-urlencoded, chỉ kèm ID deal (readme_design.md mục 7).
 */
@ApiTags('Webhooks')
@Controller('webhooks/bitrix24')
export class BitrixWebhookController {
  constructor(private readonly intake: WebhookIntakeService) {}

  @Post('deals')
  @Public()
  @HttpCode(200)
  @UseGuards(BitrixTokenGuard)
  @ApiOperation(API_DOC.WEBHOOK.BITRIX)
  @ApiConsumes('application/x-www-form-urlencoded')
  @ApiOkResponse({ schema: { example: { received: true } } })
  receive(
    @Body() body: Record<string, unknown>,
  ): Promise<{ received: true; ignored?: true }> {
    return this.intake.acceptBitrixDeal(body ?? {});
  }
}
