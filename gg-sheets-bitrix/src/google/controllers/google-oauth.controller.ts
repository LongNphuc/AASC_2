import { Controller, Get, Header, Inject, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import {
  API_DOC,
  ERROR,
  LOG,
  MESSAGE,
} from '../../common/constants/messages.constant';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import { SheetsClient } from '../clients/sheets.client';
import { GoogleAuthService } from '../services/google-auth.service';
import { GoogleOAuthService } from '../services/google-oauth.service';

@ApiTags(API_DOC.GOOGLE.TAG)
@ApiSecurity('api-key')
@Controller('google')
export class GoogleOAuthController {
  private readonly logger = new ServiceLogger(
    LogService.API,
    GoogleOAuthController.name,
  );

  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly auth: GoogleAuthService,
    private readonly sheets: SheetsClient,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  @Post('oauth/url')
  @ApiOperation({ summary: API_DOC.GOOGLE.OAUTH_URL })
  createUrl() {
    return this.oauth.createAuthUrl();
  }

  @Public()
  @Get('oauth/callback')
  @Header('content-type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: API_DOC.GOOGLE.OAUTH_CALLBACK })
  async callback(@Query('code') code: string, @Query('state') state: string) {
    const email = await this.oauth.handleCallback(code, state);
    this.logger.log(LOG.GOOGLE.OAUTH_CONNECTED(email));
    return MESSAGE.GOOGLE.CONNECTED_PAGE(email);
  }

  @Get('status')
  @ApiOperation({ summary: API_DOC.GOOGLE.STATUS })
  async status() {
    const { authMode, spreadsheetId, sheetName } = this.config.google;
    const account = await this.auth.accountEmail();
    const { expiresAt, refreshedAt, valid } = await this.auth.tokenStatus();
    const token = { valid, expiresAt, refreshedAt };
    if (!spreadsheetId) {
      return {
        mode: authMode,
        account,
        token,
        error: ERROR.SYSTEM.MISSING_CONFIG('GOOGLE_SPREADSHEET_ID'),
      };
    }
    try {
      const info = await this.sheets.getSpreadsheet(spreadsheetId);
      const tabs = info.tabs.map((t) => t.title);
      return {
        mode: authMode,
        account,
        token,
        spreadsheet: { title: info.title, readable: true },
        sheet: {
          name: sheetName,
          found: !!sheetName && tabs.includes(sheetName),
        },
        tabs,
      };
    } catch (error) {
      return {
        mode: authMode,
        account,
        token,
        spreadsheet: { readable: false },
        errorKbn: errorKbnOf(error),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
