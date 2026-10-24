import { DynamicModule, Module } from '@nestjs/common';
import { BitrixMockController } from './bitrix/bitrix-mock.controller';
import { BitrixMockMethods } from './bitrix/bitrix-mock.methods';
import { BitrixMockStore } from './bitrix/bitrix-mock.store';
import { OutboundWebhookSender } from './bitrix/outbound-webhook.sender';
import { CallLogService } from './call-log.service';
import { ControlController } from './control.controller';
import { FaultInjector } from './fault-injector';
import { MOCK_CONFIG, type MockConfig } from './mock-config';
import { TiktokMockController } from './tiktok/tiktok-mock.controller';

/** Bitrix24 và TikTok giả (process mock, hoặc chạy trong process test). */
@Module({})
export class MockModule {
  static forRoot(config: MockConfig): DynamicModule {
    return {
      module: MockModule,
      controllers: [
        BitrixMockController,
        TiktokMockController,
        ControlController,
      ],
      providers: [
        { provide: MOCK_CONFIG, useValue: config },
        BitrixMockStore,
        BitrixMockMethods,
        FaultInjector,
        CallLogService,
        OutboundWebhookSender,
      ],
      exports: [BitrixMockStore, FaultInjector, CallLogService, MOCK_CONFIG],
    };
  }
}
