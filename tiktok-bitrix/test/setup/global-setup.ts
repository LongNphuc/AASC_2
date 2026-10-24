import 'reflect-metadata';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../src/database/data-source';
import { testEnv } from './test-env';

/**
 * Chạy một lần trước integration/E2E test: tạo lại schema trống, chạy
 * migration, xóa Redis của test.
 */
export default async function globalSetup(): Promise<void> {
  const env = testEnv();
  const dataSource = await new DataSource(
    dataSourceOptions(env.DATABASE_URL),
  ).initialize();
  try {
    await dataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
  const redis = new Redis(env.REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}
