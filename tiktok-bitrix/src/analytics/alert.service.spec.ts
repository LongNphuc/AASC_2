import { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { AlertTypeKbn } from '../common/kbn/type.kbn';
import { logFiles } from '../common/logging/log-files';
import type { Alert } from './entities/alert.entity';
import { AlertService } from './services/alert.service';

/** AlertService với bảng alerts giả: `recent` là số cảnh báo cùng fingerprint trong một giờ. */
function setup(recent = 0) {
  const saved: Partial<Alert>[] = [];
  const repo = {
    createQueryBuilder: () => ({
      where() {
        return this;
      },
      andWhere() {
        return this;
      },
      getCount: () => Promise.resolve(recent),
    }),
    create: (values: Partial<Alert>) => values,
    save: (values: Partial<Alert>) => {
      saved.push(values);
      return Promise.resolve({ ...values, uuid: 'a1' });
    },
  } as unknown as Repository<Alert>;
  return { service: new AlertService(repo), saved };
}

describe('AlertService', () => {
  const appWarn = Logger.prototype.warn as jest.Mock;
  const fileWrite = jest.spyOn(logFiles, 'write');
  beforeEach(() => {
    appWarn.mockClear();
    fileWrite.mockClear();
  });

  it.each([
    [AlertTypeKbn.CPL_HIGH, 'app'],
    [AlertTypeKbn.WORKER_DOWN, 'app'],
    [AlertTypeKbn.CONVERSION_DROP, 'services/service_analytics.log'],
    [AlertTypeKbn.DLQ_NOT_EMPTY, 'services/service_job.log'],
    [AlertTypeKbn.SYNC_FAILED, 'services/service_job.log'],
  ])('%s: lưu bảng alerts, ghi log WARN vào %s', async (type, target) => {
    const { service, saved } = setup();
    await service.raise(type, 'campaign:1', 'nội dung cảnh báo');
    expect(saved).toEqual([
      expect.objectContaining({
        typeKbn: type,
        fingerprint: `${AlertTypeKbn[type]}:campaign:1`,
      }),
    ]);
    if (target === 'app') {
      expect(appWarn).toHaveBeenCalledWith(
        `${AlertTypeKbn[type]}: nội dung cảnh báo`,
      );
      expect(fileWrite).not.toHaveBeenCalled();
    } else {
      expect(appWarn).not.toHaveBeenCalled();
      expect(fileWrite).toHaveBeenCalledWith(
        target,
        expect.stringMatching(
          /\| WARN +\|.*cảnh báo .* \| ALERT \|.*nội dung cảnh báo/,
        ),
      );
    }
  });

  it('cùng loại, cùng đối tượng trong một giờ: không lưu, không ghi log', async () => {
    const { service, saved } = setup(1);
    expect(
      await service.raise(AlertTypeKbn.SYNC_FAILED, 'event:x', 'lỗi'),
    ).toBeNull();
    expect(saved).toEqual([]);
    expect(fileWrite).not.toHaveBeenCalled();
  });
});
