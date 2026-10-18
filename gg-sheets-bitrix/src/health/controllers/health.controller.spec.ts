import type { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('DB chạy thì ok, DB lỗi thì degraded', async () => {
    const up = new HealthController({
      query: jest.fn().mockResolvedValue([1]),
    } as unknown as DataSource);
    expect(await up.check()).toMatchObject({ status: 'ok', db: 'ok' });
    const down = new HealthController({
      query: jest.fn().mockRejectedValue(new Error('x')),
    } as unknown as DataSource);
    expect(await down.check()).toMatchObject({
      status: 'degraded',
      db: 'down',
    });
  });
});
