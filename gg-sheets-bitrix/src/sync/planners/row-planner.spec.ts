import { SHEET } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { mapRow } from '../../mapping/mappers/row-to-lead.mapper';
import { cells, MAPPING, METADATA } from '../../testing/fixtures';
import type { SheetRow } from '../types/sync.types';
import { syncHash } from './row-hash';
import { planRows } from './row-planner';

const data = { 'Tên khách hàng': 'Nguyễn An', Email: 'a@abc.vn' };
const hashOf = (values: Record<string, string>) =>
  syncHash(mapRow(cells(values), MAPPING, METADATA).payload);

function row(
  overrides: Partial<SheetRow> = {},
  values: Record<string, string> = data,
): SheetRow {
  return {
    rowNumber: 2,
    cells: cells(values),
    leadIdText: '',
    syncHash: '',
    syncStatus: '',
    errorText: '',
    fingerprint: 'f',
    ...overrides,
  };
}

describe('planRows', () => {
  const plan = (r: SheetRow) => planRows([r], MAPPING, METADATA)[0];

  it('chưa có Lead ID → NEW', () => {
    expect(plan(row()).action).toBe('NEW');
  });

  it('có Lead ID, hash cũ trống hoặc khác → UPDATE', () => {
    expect(plan(row({ leadIdText: '123' }))).toMatchObject({
      action: 'UPDATE',
      leadId: 123,
    });
    expect(plan(row({ leadIdText: '123', syncHash: 'cu' })).action).toBe(
      'UPDATE',
    );
  });

  it('có Lead ID, hash giống: đang "Đã đồng bộ" → SKIP; đang "Lỗi" → REFRESH_STATUS', () => {
    const hash = hashOf(data);
    expect(
      plan(
        row({
          leadIdText: '123',
          syncHash: hash,
          syncStatus: SHEET.STATUS.SYNCED,
        }),
      ).action,
    ).toBe('SKIP');
    expect(
      plan(
        row({
          leadIdText: '123',
          syncHash: hash,
          syncStatus: SHEET.STATUS.ERROR,
        }),
      ).action,
    ).toBe('REFRESH_STATUS');
  });

  it('dữ liệu sai → INVALID, gộp mọi lỗi của hàng', () => {
    const result = plan(row({}, { 'Tên khách hàng': 'Võ Minh 2', Email: 'x' }));
    expect(result.action).toBe('INVALID');
    expect(result.issue).toEqual({
      errorKbn: ErrorKbn.VALIDATION,
      message:
        'Tên khách hàng: không được chứa chữ số; Email: email không hợp lệ; Cần có ít nhất một trong: Email, Số điện thoại',
    });
  });

  it('Lead ID không phải số dương → INVALID', () => {
    expect(plan(row({ leadIdText: 'abc' })).issue!.message).toBe(
      "Lead ID 'abc' không hợp lệ",
    );
  });

  describe('đồng bộ hai chiều: trường do Bitrix24 làm chủ (owner: bitrix)', () => {
    const owned = new Set(['STATUS_ID', 'ASSIGNED_BY_ID']);
    const planOwned = (r: SheetRow) =>
      planRows([r], MAPPING, METADATA, owned)[0];
    const withStatus = (status: string) => ({ ...data, 'Trạng thái': status });

    it('hash không tính trường đó: Bitrix24 ghi trạng thái mới về Sheet thì hàng vẫn "không đổi"', () => {
      const before = planOwned(row({}, withStatus('Chưa giao người xử lý')));
      const after = planOwned(row({}, withStatus('Trong tiến trình')));
      expect(after.hash).toBe(before.hash);
      expect(
        planOwned(
          row(
            {
              leadIdText: '7',
              syncHash: before.hash,
              syncStatus: SHEET.STATUS.SYNCED,
            },
            withStatus('Trong tiến trình'),
          ),
        ).action,
      ).toBe('SKIP');
    });

    it('hàng đã có lead: lỗi ở cột đó không chặn hàng; hàng mới thì vẫn báo lỗi', () => {
      const bad = withStatus('Không có trạng thái này');
      expect(planOwned(row({ leadIdText: '7' }, bad)).action).toBe('UPDATE');
      expect(planOwned(row({}, bad))).toMatchObject({
        action: 'INVALID',
        issue: { errorKbn: ErrorKbn.VALUE_NOT_MAPPED },
      });
    });
  });
});
