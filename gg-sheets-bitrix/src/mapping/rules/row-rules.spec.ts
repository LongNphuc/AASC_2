import { checkRules, isRuleName, listRules, RULE_NAMES } from './row-rules';

describe('row-rules', () => {
  it('có đủ 5 luật, mỗi luật có mô tả', () => {
    expect(RULE_NAMES).toEqual([
      'is_not_blank',
      'is_not_contain_digit',
      'is_email',
      'is_phone_vn',
      'is_positive_number',
    ]);
    expect(listRules().every((r) => r.description.length > 0)).toBe(true);
    expect(isRuleName('is_mail')).toBe(false);
  });

  it('trả thông báo của luật đầu tiên bị vi phạm', () => {
    expect(
      checkRules(
        ['is_not_blank', 'is_not_contain_digit'],
        { text: 'Võ Minh 2' },
        'Tên',
      ),
    ).toBe('Tên: không được chứa chữ số');
    expect(checkRules(['is_not_blank'], { text: '' }, 'Tên')).toBe(
      'Tên: không được trống',
    );
    expect(checkRules(['is_email'], { text: 'x' }, 'Email')).toBe(
      'Email: email không hợp lệ',
    );
    expect(checkRules(['is_phone_vn'], { text: '123' }, 'SĐT')).toBe(
      'SĐT: số điện thoại Việt Nam không hợp lệ',
    );
    expect(checkRules(['is_positive_number'], { text: '0' }, 'Ngân sách')).toBe(
      'Ngân sách: phải là số lớn hơn 0',
    );
  });

  it('ô trống chỉ vi phạm is_not_blank; luật lạ bị bỏ qua', () => {
    expect(
      checkRules(['is_email', 'is_phone_vn'], { text: '' }, 'X'),
    ).toBeNull();
    expect(checkRules(['unknown_rule'], { text: 'abc' }, 'X')).toBeNull();
    expect(checkRules(undefined, { text: 'abc' }, 'X')).toBeNull();
  });
});
