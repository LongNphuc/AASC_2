import { METADATA } from '../../testing/fixtures';
import { parseDate } from './date.transformer';
import { isValidEmail, normalizeEmail } from './email.transformer';
import {
  lookupValueMap,
  normalizeName,
  resolveEnumeration,
  resolveStatus,
  resolveUser,
  toYesNo,
} from './enum.transformer';
import { parseNumber } from './number.transformer';
import { normalizePhone, toNationalPhone } from './phone.transformer';

describe('phone.transformer', () => {
  it.each([
    ['0901 234 567', '+84901234567'],
    ['0933-456-789', '+84933456789'],
    ['(090) 123.4567', '+84901234567'],
    ['+84 912 345 678', '+84912345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone({ text: input })).toBe(expected);
  });

  it('ô bị Sheets đổi thành số (mất số 0 đầu) vẫn đọc đúng', () => {
    expect(normalizePhone({ text: '912345678', value: 912345678 })).toBe(
      '+84912345678',
    );
  });

  it('số sai thì null', () => {
    expect(normalizePhone({ text: '123' })).toBeNull();
    expect(normalizePhone({ text: '' })).toBeNull();
  });

  it('dạng trong nước', () => {
    expect(toNationalPhone('+84901234567')).toBe('0901234567');
    expect(toNationalPhone('+12025550123')).toBe('+12025550123');
  });
});

describe('email.transformer', () => {
  it('bỏ khoảng trắng, viết thường; kiểm tra hợp lệ', () => {
    expect(normalizeEmail(' DUNG.PHAM@EXAMPLE.COM ')).toBe(
      'dung.pham@example.com',
    );
    expect(isValidEmail('a@b.vn')).toBe(true);
    expect(isValidEmail('email-sai')).toBe(false);
  });
});

describe('number.transformer', () => {
  it.each([
    ['50.000.000 đ', 50000000],
    ['20.000.000', 20000000],
    ['1,5', 1.5],
    ['1.234,5', 1234.5],
    ['1,234.5', 1234.5],
    ['1.500', 1500],
    ['12.5', 12.5],
    ['-3', -3],
  ])('%s → %d', (input, expected) => {
    expect(parseNumber({ text: input })).toBe(expected);
  });

  it('ô kiểu số lấy luôn giá trị; ô không có chữ số thì null', () => {
    expect(parseNumber({ text: '50,000,000', value: 50000000 })).toBe(50000000);
    expect(parseNumber({ text: 'năm mươi triệu' })).toBeNull();
  });
});

describe('date.transformer', () => {
  it('ô ngày dạng số của Sheets', () => {
    expect(
      parseDate({ text: '15/10/2026', value: 46310, formatType: 'DATE' }),
    ).toBe('2026-10-15');
  });

  it('ô chữ dd/mm/yyyy hoặc yyyy-mm-dd; ngày không có thật thì null', () => {
    expect(parseDate({ text: '15/10/2026' })).toBe('2026-10-15');
    expect(parseDate({ text: '2026-10-05' })).toBe('2026-10-05');
    expect(parseDate({ text: '31/02/2026' })).toBeNull();
    expect(parseDate({ text: 'hôm qua' })).toBeNull();
  });
});

describe('enum.transformer', () => {
  it('so tên không phân biệt dấu, hoa thường', () => {
    expect(normalizeName('  Đã  Xử Lý ')).toBe('da xu ly');
    expect(lookupValueMap('Website', { website: 'WEB' })).toBe('WEB');
    expect(lookupValueMap('x', undefined)).toBeUndefined();
  });

  it('giai đoạn: tên trên CRM hoặc mã', () => {
    const statuses = METADATA.statuses.STATUS;
    expect(resolveStatus('Chưa giao người xử lý', statuses)).toBe('NEW');
    expect(resolveStatus('in_process', statuses)).toBe('IN_PROCESS');
    expect(resolveStatus('Mới', statuses)).toBeNull();
    expect(resolveStatus('Mới', statuses, { Mới: 'NEW' })).toBe('NEW');
  });

  it('danh sách chọn của custom field', () => {
    const items = METADATA.fields.UF_CRM_INTEREST.items!;
    expect(resolveEnumeration('giáo dục', items)).toBe('47');
    expect(resolveEnumeration('45', items)).toBe('45');
    expect(resolveEnumeration('Nông nghiệp', items)).toBeNull();
  });

  it('người dùng: email, họ tên theo hai thứ tự, không tìm thấy, trùng tên', () => {
    const users = [
      ...METADATA.users,
      { ID: '2', NAME: 'An', LAST_NAME: 'Tran' },
      { ID: '3', NAME: 'An', LAST_NAME: 'Tran' },
    ];
    expect(resolveUser('LONG@example.com', users)).toEqual({ id: 1 });
    expect(resolveUser('Nguyen Phuc Long', users)).toEqual({ id: 1 });
    expect(resolveUser('Long Nguyễn Phúc', users)).toEqual({ id: 1 });
    expect(resolveUser('ai@example.com', users)).toEqual({
      error: 'not_found',
    });
    expect(resolveUser('An Tran', users)).toEqual({ error: 'ambiguous' });
  });

  it('đúng/sai', () => {
    expect(toYesNo('Có')).toBe('Y');
    expect(toYesNo('không')).toBe('N');
  });
});
