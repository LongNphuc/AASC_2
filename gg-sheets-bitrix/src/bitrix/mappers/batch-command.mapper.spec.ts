import { toBatchCommand, toQueryString } from './batch-command.mapper';

describe('batch-command.mapper', () => {
  it('trường lồng nhau và mảng theo kiểu PHP', () => {
    expect(
      toQueryString({
        fields: {
          NAME: 'Nguyễn An',
          PHONE: [{ VALUE: '+84901234567', VALUE_TYPE: 'WORK' }],
        },
      }),
    ).toBe(
      'fields[NAME]=Nguy%E1%BB%85n%20An&fields[PHONE][0][VALUE]=%2B84901234567&fields[PHONE][0][VALUE_TYPE]=WORK',
    );
  });

  it('bỏ giá trị null, undefined; mảng chuỗi đơn giản', () => {
    expect(
      toQueryString({
        select: ['ID', 'EMAIL'],
        filter: { EMAIL: 'a@b.vn', X: undefined },
      }),
    ).toBe('select[0]=ID&select[1]=EMAIL&filter[EMAIL]=a%40b.vn');
  });

  it('dựng lệnh batch', () => {
    expect(toBatchCommand({ method: 'crm.lead.fields', params: {} })).toBe(
      'crm.lead.fields',
    );
    expect(
      toBatchCommand({ method: 'crm.lead.update', params: { id: 5 } }),
    ).toBe('crm.lead.update?id=5');
  });
});
