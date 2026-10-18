import { multiFieldKey, newMultiValues } from './multifield.mapper';

describe('multifield.mapper', () => {
  it('SĐT so theo chữ số: 0… và +84… là một số', () => {
    expect(multiFieldKey('PHONE', '0901 234 567')).toBe(
      multiFieldKey('PHONE', '+84901234567'),
    );
    expect(multiFieldKey('EMAIL', ' A@B.VN ')).toBe('a@b.vn');
  });

  it('chỉ giữ giá trị lead chưa có (tránh nhân đôi SĐT khi cập nhật)', () => {
    const current = [{ ID: '10', VALUE: '0901234567', VALUE_TYPE: 'WORK' }];
    expect(
      newMultiValues('PHONE', current, [{ VALUE: '+84901234567' }]),
    ).toEqual([]);
    expect(
      newMultiValues('PHONE', current, [{ VALUE: '+84912345678' }]),
    ).toEqual([{ VALUE: '+84912345678' }]);
    expect(newMultiValues('EMAIL', undefined, [{ VALUE: 'a@b.vn' }])).toEqual([
      { VALUE: 'a@b.vn' },
    ]);
  });
});
