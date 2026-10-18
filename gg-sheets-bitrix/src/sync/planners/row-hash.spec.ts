import { contentFingerprint, stableStringify, syncHash } from './row-hash';

describe('row-hash', () => {
  it('thứ tự khóa không ảnh hưởng hash', () => {
    expect(syncHash({ NAME: 'A', PHONE: [{ VALUE: '1' }] })).toBe(
      syncHash({ PHONE: [{ VALUE: '1' }], NAME: 'A' }),
    );
    expect(stableStringify({ b: 1, a: { d: 2, c: undefined } })).toBe(
      '{"a":{"d":2},"b":1}',
    );
  });

  it('dữ liệu gửi đi khác thì hash khác; 16 ký tự hex', () => {
    const a = syncHash({ NAME: 'A', OPPORTUNITY: 50000000 });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(syncHash({ NAME: 'A', OPPORTUNITY: 80000000 })).not.toBe(a);
  });

  it('dấu vân tay nội dung', () => {
    expect(contentFingerprint(['A', 'B'])).not.toBe(
      contentFingerprint(['A', 'C']),
    );
  });
});
