import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { appConfig, type AppConfig } from '../config/app-config';
import { SheetsClient } from './clients/sheets.client';
import { GoogleOAuthController } from './controllers/google-oauth.controller';
import { GoogleAuth } from './entities/google-auth.entity';
import { GoogleAuthService } from './services/google-auth.service';
import { GoogleOAuthService } from './services/google-oauth.service';

/**
 * Google Sheets API v4: token (service account / OAuth user, lưu trong bảng
 * google_auth), đọc và ghi Sheet.
 */
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig) => ({ timeout: config.httpTimeoutMs }),
    }),
    TypeOrmModule.forFeature([GoogleAuth]),
  ],
  controllers: [GoogleOAuthController],
  providers: [GoogleAuthService, GoogleOAuthService, SheetsClient],
  exports: [SheetsClient, GoogleAuthService],
})
export class GoogleModule {}
