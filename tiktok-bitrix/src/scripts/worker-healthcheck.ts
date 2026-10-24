import Redis from 'ioredis';
import { hostname } from 'node:os';
import { HEARTBEAT_PREFIX } from '../queues/services/worker-heartbeat.service';

/**
 * Healthcheck của container worker (docker-compose.yml): nhịp tim của chính
 * worker này trong Redis còn mới thì thoát 0, không thì 1.
 */
async function main(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });
  await redis.connect();
  const value = await redis.get(`${HEARTBEAT_PREFIX}${hostname()}`);
  await redis.quit();
  const stale = Number(process.env.WORKER_STALE_SECONDS ?? 30) * 1000;
  process.exit(value && Date.now() - Number(value) <= stale ? 0 : 1);
}

main().catch(() => process.exit(1));
