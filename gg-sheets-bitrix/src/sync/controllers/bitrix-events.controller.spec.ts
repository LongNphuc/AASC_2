import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/auth/public.decorator';
import type { BitrixEventService } from '../services/bitrix-event.service';
import { BitrixEventsController } from './bitrix-events.controller';

describe('BitrixEventsController', () => {
  it('công khai (Bitrix24 không gửi được x-api-key) và chuyển body cho BitrixEventService', async () => {
    const handle = jest.fn().mockResolvedValue({
      accepted: false,
      reason: 'EVENT_IGNORED',
    });
    const controller = new BitrixEventsController({
      handle,
    } as unknown as BitrixEventService);
    const body = { event: 'ONCRMDEALUPDATE' };

    await expect(controller.receive(body)).resolves.toEqual({
      accepted: false,
      reason: 'EVENT_IGNORED',
    });
    expect(handle).toHaveBeenCalledWith(body);
    expect(
      new Reflector().get<boolean>(
        IS_PUBLIC_KEY,
        BitrixEventsController.prototype.receive,
      ),
    ).toBe(true);
  });
});
