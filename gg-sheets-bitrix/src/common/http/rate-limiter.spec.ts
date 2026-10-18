import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('2 request/giây: request thứ hai chờ 500 ms, thứ ba chờ 1000 ms', async () => {
    const now = 1_000_000;
    const sleep = jest.fn().mockResolvedValue(undefined);
    const limiter = new RateLimiter(2, () => now, sleep);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });

  it('đã qua chỗ kế tiếp thì không chờ', async () => {
    let now = 1_000_000;
    const sleep = jest.fn().mockResolvedValue(undefined);
    const limiter = new RateLimiter(2, () => now, sleep);

    await limiter.acquire();
    now += 600;
    await limiter.acquire();

    expect(sleep).not.toHaveBeenCalled();
  });
});
