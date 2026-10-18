import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { API_DOC } from '../../common/constants/messages.constant';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { maskWebhookUrl } from '../../common/logging/redact';
import { appConfig, type AppConfig } from '../../config/app-config';
import { BitrixWebhookClient } from '../clients/bitrix-webhook.client';
import { BitrixMetadataService } from '../services/bitrix-metadata.service';

const REQUIRED_SCOPES = ['crm', 'user'];

@ApiTags(API_DOC.BITRIX.TAG)
@ApiSecurity('api-key')
@Controller('bitrix')
export class BitrixController {
  constructor(
    private readonly bitrix: BitrixWebhookClient,
    private readonly metadata: BitrixMetadataService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  @Get('status')
  @ApiOperation({ summary: API_DOC.BITRIX.STATUS })
  async status() {
    const webhook = this.config.bitrix.webhookUrl
      ? maskWebhookUrl(this.config.bitrix.webhookUrl)
      : null;
    try {
      const scopes = await this.bitrix.call<string[]>('scope');
      const missingScopes = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
      return { ok: missingScopes.length === 0, webhook, scopes, missingScopes };
    } catch (error) {
      return {
        ok: false,
        webhook,
        errorKbn: errorKbnOf(error),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Get('lead-fields')
  @ApiOperation({ summary: API_DOC.BITRIX.LEAD_FIELDS })
  async leadFields() {
    const fields = await this.metadata.leadFields();
    return Object.entries(fields).map(([code, f]) => ({
      code,
      title: f.formLabel || f.listLabel || f.title || code,
      type: f.type,
      isMultiple: !!f.isMultiple,
      isReadOnly: !!f.isReadOnly,
      ...(f.statusType ? { statusType: f.statusType } : {}),
      ...(f.items ? { items: f.items.map((i) => i.VALUE) } : {}),
    }));
  }
}
