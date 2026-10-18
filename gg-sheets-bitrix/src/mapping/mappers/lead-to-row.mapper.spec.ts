import { SHEET } from '../../common/constants/messages.constant';
import { METADATA, text } from '../../testing/fixtures';
import type { MappingColumn } from '../types/mapping.types';
import { sameValue, toSheetValue } from './lead-to-row.mapper';

const column = (
  field: string,
  extra: Partial<MappingColumn> = {},
): MappingColumn => ({ header: 'X', field, ...extra });
const f = (code: string) => METADATA.fields[code];

describe('lead-to-row.mapper', () => {
  describe('toSheetValue: giá trị Bitrix24 → chữ trên Sheet', () => {
    it('trạng thái: tên trên CRM; có value_map thì dùng khóa của value_map; mã lạ giữ nguyên', () => {
      expect(
        toSheetValue(
          column('STATUS_ID'),
          f('STATUS_ID'),
          'IN_PROCESS',
          METADATA,
        ),
      ).toBe('Trong tiến trình');
      expect(
        toSheetValue(
          column('STATUS_ID', { value_map: { 'Đang chăm sóc': 'IN_PROCESS' } }),
          f('STATUS_ID'),
          'IN_PROCESS',
          METADATA,
        ),
      ).toBe('Đang chăm sóc');
      expect(
        toSheetValue(column('STATUS_ID'), f('STATUS_ID'), 'LOST', METADATA),
      ).toBe('LOST');
    });

    it('người dùng: họ tên nếu không trùng ai, không thì email; không có thì ID', () => {
      const user = f('ASSIGNED_BY_ID');
      expect(toSheetValue(column('ASSIGNED_BY_ID'), user, '1', METADATA)).toBe(
        'Long Nguyen Phuc',
      );
      const twins = {
        ...METADATA,
        users: [
          ...METADATA.users,
          {
            ID: '2',
            NAME: 'Long',
            LAST_NAME: 'Nguyen Phuc',
            EMAIL: 'long2@example.com',
          },
        ],
      };
      expect(toSheetValue(column('ASSIGNED_BY_ID'), user, 2, twins)).toBe(
        'long2@example.com',
      );
      expect(toSheetValue(column('ASSIGNED_BY_ID'), user, 99, METADATA)).toBe(
        '99',
      );
    });

    it('danh sách chọn, số, ngày, đúng/sai, trống', () => {
      expect(
        toSheetValue(
          column('UF_CRM_INTEREST'),
          f('UF_CRM_INTEREST'),
          '47',
          METADATA,
        ),
      ).toBe('Giáo dục');
      expect(
        toSheetValue(
          column('OPPORTUNITY'),
          f('OPPORTUNITY'),
          '80000000.00',
          METADATA,
        ),
      ).toBe(80000000);
      expect(
        toSheetValue(
          column('BIRTHDATE'),
          f('BIRTHDATE'),
          '2026-10-15T00:00:00+07:00',
          METADATA,
        ),
      ).toBe('15/10/2026');
      expect(
        toSheetValue(column('OPENED'), { type: 'char' }, 'Y', METADATA),
      ).toBe(SHEET.BOOLEAN.YES);
      expect(
        toSheetValue(column('COMMENTS'), f('COMMENTS'), null, METADATA),
      ).toBe('');
    });
  });

  describe('sameValue: so theo nghĩa, không theo cách viết', () => {
    it('email người dùng và ID; tên giai đoạn và mã; số có dấu chấm', () => {
      expect(
        sameValue(
          column('ASSIGNED_BY_ID'),
          f('ASSIGNED_BY_ID'),
          text('LONG@example.com'),
          '1',
          METADATA,
        ),
      ).toBe(true);
      expect(
        sameValue(
          column('STATUS_ID'),
          f('STATUS_ID'),
          text('Chưa giao người xử lý'),
          'NEW',
          METADATA,
        ),
      ).toBe(true);
      expect(
        sameValue(
          column('STATUS_ID'),
          f('STATUS_ID'),
          text('Chưa giao người xử lý'),
          'IN_PROCESS',
          METADATA,
        ),
      ).toBe(false);
      expect(
        sameValue(
          column('OPPORTUNITY'),
          f('OPPORTUNITY'),
          { text: '50.000.000', value: 50000000 },
          '50000000.00',
          METADATA,
        ),
      ).toBe(true);
    });

    it('ô trống, giá trị trống, ô không đổi được', () => {
      const comments = f('COMMENTS');
      expect(
        sameValue(column('COMMENTS'), comments, text(''), '', METADATA),
      ).toBe(true);
      expect(
        sameValue(column('COMMENTS'), comments, text(''), 'mới', METADATA),
      ).toBe(false);
      expect(
        sameValue(column('COMMENTS'), comments, text('cũ'), null, METADATA),
      ).toBe(false);
      expect(
        sameValue(
          column('STATUS_ID'),
          f('STATUS_ID'),
          text('lung tung'),
          'NEW',
          METADATA,
        ),
      ).toBe(false);
    });
  });
});
