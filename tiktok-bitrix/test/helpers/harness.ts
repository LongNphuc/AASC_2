import 'reflect-metadata';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ApiModule } from '../../src/api.module';
import { REDIS } from '../../src/common/redis/redis.module';
import { ConfigurationService } from '../../src/configurations/services/configuration.service';
import { CallLogService } from '../../src/mock/call-log.service';
import { BitrixMockStore } from '../../src/mock/bitrix/bitrix-mock.store';
import { FaultInjector } from '../../src/mock/fault-injector';
import { MOCK_CONFIG, type MockConfig } from '../../src/mock/mock-config';
import { MockModule } from '../../src/mock/mock.module';
import { QUEUE } from '../../src/queues/queue-names';
import { HEARTBEAT_PREFIX } from '../../src/queues/services/worker-heartbeat.service';
import { WorkerModule } from '../../src/worker.module';
import { MOCK_PORT } from '../setup/test-env';

/** Bitrix24, TikTok giả chạy trong process test, cổng MOCK_PORT. */
export interface MockHandle {
  app: INestApplication;
  config: MockConfig;
  store: BitrixMockStore;
  faults: FaultInjector;
  calls: CallLogService;
  reset(): void;
}

export async function startMock(): Promise<MockHandle> {
  const config: MockConfig = {
    port: MOCK_PORT,
    // Đặt lại sau khi api mở cổng (startApi với listen).
    appWebhookUrl: 'http://127.0.0.1:1/webhooks/bitrix24/deals',
    outboundToken: process.env.BITRIX24_OUTBOUND_TOKEN ?? '',
  };
  const app = await NestFactory.create(MockModule.forRoot(config), {
    logger: false,
  });
  await app.listen(MOCK_PORT, '127.0.0.1');
  const store = app.get(BitrixMockStore);
  const faults = app.get(FaultInjector);
  const calls = app.get(CallLogService);
  return {
    app,
    config: app.get<MockConfig>(MOCK_CONFIG),
    store,
    faults,
    calls,
    reset() {
      store.reset();
      calls.clear();
      faults.clear();
    },
  };
}

/** Process api trong test: đủ guard, filter, pipe, body parser như main.ts. */
export interface ApiHandle {
  app: INestApplication;
  dataSource: DataSource;
  redis: Redis;
  http: () => ReturnType<typeof request>;
  /** Địa chỉ khi api mở cổng thật (cho mock gọi webhook về). */
  url?: string;
}

export async function startApi(
  options: { listen?: boolean; mock?: MockHandle } = {},
): Promise<ApiHandle> {
  const moduleRef = await Test.createTestingModule({
    imports: [ApiModule],
  }).compile();
  const app = moduleRef.createNestApplication({
    bodyParser: false,
    logger: false,
  });
  let url: string | undefined;
  if (options.listen) {
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    if (options.mock)
      options.mock.config.appWebhookUrl = `${url}/webhooks/bitrix24/deals`;
  } else {
    await app.init();
  }
  return {
    app,
    dataSource: app.get(DataSource),
    redis: app.get<Redis>(REDIS),
    http: () => request(app.getHttpServer() as Parameters<typeof request>[0]),
    url,
  };
}

/** Process worker trong test, như worker.ts (cả queue chạy một job mỗi lúc). */
export async function startWorker(): Promise<INestApplicationContext> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: false,
  });
  await app
    .get<Queue>(getQueueToken(QUEUE.CRM_PIPELINE))
    .setGlobalConcurrency(1);
  return app;
}

/**
 * Trạng thái sạch giữa các test: xóa dữ liệu mọi bảng (giữ bảng migrations),
 * xóa Redis, nạp lại cấu hình mặc định, reset mock. `keepQueues` khi worker
 * đang chạy: giữ khóa của BullMQ (bull:*) và nhịp tim, chỉ xóa cache, bộ đếm.
 */
export async function resetState(
  api: ApiHandle,
  mock?: MockHandle,
  options: { keepQueues?: boolean } = {},
): Promise<void> {
  const tables = await api.dataSource.query<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  await api.dataSource.query(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  if (options.keepQueues) {
    const keys = (await api.redis.keys('*')).filter(
      (key) => !key.startsWith('bull:') && !key.startsWith(HEARTBEAT_PREFIX),
    );
    if (keys.length) await api.redis.del(...keys);
  } else {
    await api.redis.flushdb();
  }
  await api.app.get(ConfigurationService).loadDefaultsIfEmpty();
  mock?.reset();
}

export async function stopAll(
  ...apps: (
    { close(): Promise<void> } | { app: { close(): Promise<void> } } | undefined
  )[]
) {
  for (const item of apps) {
    if (!item) continue;
    await ('app' in item ? item.app.close() : item.close());
  }
}
