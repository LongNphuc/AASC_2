import type Redis from 'ioredis';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Token bucket trong Redis, dùng chung cho mọi process (api, worker): nạp
 * `rps` lượt mỗi giây, chứa tối đa `burst` lượt (readme_improvements.md mục 3).
 * Lua chạy nguyên khối trong Redis nên hai process không lấy trùng một lượt;
 * giờ lấy từ Redis (TIME) nên giờ các máy lệch nhau cũng không sao.
 *
 * Trả số mili giây phải chờ (0 = lấy được lượt ngay).
 */
const TAKE_SCRIPT = `
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1]) or burst
local ts = tonumber(data[2]) or now
tokens = math.min(burst, tokens + math.max(0, now - ts) * rate / 1000)
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
else
  wait = math.ceil((1 - tokens) * 1000 / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(burst * 1000 / rate) + 1000)
return wait
`;

export async function tryTake(
  redis: Redis,
  key: string,
  rps: number,
  burst: number,
): Promise<number> {
  const wait = await redis.eval(TAKE_SCRIPT, 1, key, rps, burst);
  return Number(wait);
}

/** Chờ tới khi lấy được một lượt. */
export async function take(
  redis: Redis,
  key: string,
  rps: number,
  burst: number,
): Promise<void> {
  for (;;) {
    const wait = await tryTake(redis, key, rps, burst);
    if (wait <= 0) return;
    await sleep(wait);
  }
}
