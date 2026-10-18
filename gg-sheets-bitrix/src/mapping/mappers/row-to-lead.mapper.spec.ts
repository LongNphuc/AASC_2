import { ErrorKbn } from '../../common/kbn/error.kbn';
import { cells, MAPPING, METADATA } from '../../testing/fixtures';
import { mapRow } from './row-to-lead.mapper';

const fullRow = {
  'Tên khách hàng': 'Nguyễn Văn An',
  Email: ' AN.NGUYEN@example.com ',
  'Số điện thoại': '0901 234 567',
  'Công ty': 'Công ty ABC',
  'Nguồn lead': 'website',
  'Ngân sách dự kiến': '50.000.000',
  'Trạng thái': 'Chưa giao người xử lý',
  'Người phụ trách': 'long@example.com',
  'Ghi chú': 'Gọi lại thứ 2',
  'Lĩnh vực quan tâm': 'Bất động sản',
};

describe('mapRow', () => {
  it('đổi mọi cột theo mapping, giá trị đổi theo kiểu trường (không viết cứng tên trường)', () => {
    const result = mapRow(cells(fullRow), MAPPING, METADATA);
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual({
      NAME: 'Nguyễn Văn An',
      EMAIL: [{ VALUE: 'an.nguyen@example.com', VALUE_TYPE: 'WORK' }],
      PHONE: [{ VALUE: '+84901234567', VALUE_TYPE: 'WORK' }],
      COMPANY_TITLE: 'Công ty ABC',
      SOURCE_ID: 'WEB',
      UTM_SOURCE: 'website',
      OPPORTUNITY: 50000000,
      STATUS_ID: 'NEW',
      ASSIGNED_BY_ID: 1,
      COMMENTS: 'Gọi lại thứ 2',
      UF_CRM_INTEREST: '45',
      TITLE: 'Nguyễn Văn An - Công ty ABC',
    });
    expect(result).toMatchObject({
      email: 'an.nguyen@example.com',
      phone: '+84901234567',
      name: 'Nguyễn Văn An',
    });
  });

  it('ô trống thì không gửi trường đó; tiêu đề bỏ dấu nối thừa', () => {
    const result = mapRow(
      cells({ 'Tên khách hàng': 'Lê Cường', Email: 'c@x.vn' }),
      MAPPING,
      METADATA,
    );
    expect(result.issues).toEqual([]);
    expect(Object.keys(result.payload).sort()).toEqual([
      'EMAIL',
      'NAME',
      'TITLE',
    ]);
    expect(result.payload.TITLE).toBe('Lê Cường');
  });

  it('báo đủ mọi lỗi của hàng: luật kiểm tra, giá trị không có trong danh sách, người dùng lạ', () => {
    const result = mapRow(
      cells({
        ...fullRow,
        'Tên khách hàng': 'Võ Minh 2',
        Email: 'email-sai',
        'Trạng thái': 'Mới',
        'Người phụ trách': 'ai@x.vn',
        'Lĩnh vực quan tâm': 'Nông nghiệp',
      }),
      MAPPING,
      METADATA,
    );
    expect(result.issues.map((i) => i.errorKbn)).toEqual([
      ErrorKbn.VALIDATION,
      ErrorKbn.VALIDATION,
      ErrorKbn.VALUE_NOT_MAPPED,
      ErrorKbn.VALUE_NOT_MAPPED,
      ErrorKbn.VALUE_NOT_MAPPED,
    ]);
    expect(result.issues[0].message).toBe(
      'Tên khách hàng: không được chứa chữ số',
    );
  });

  it('thiếu cả email lẫn SĐT thì không tra trùng được → lỗi', () => {
    const result = mapRow(
      cells({ 'Tên khách hàng': 'Đặng Thu Hà', 'Công ty': 'Hà Studio' }),
      MAPPING,
      METADATA,
    );
    expect(result.issues).toEqual([
      {
        errorKbn: ErrorKbn.VALIDATION,
        message: 'Cần có ít nhất một trong: Email, Số điện thoại',
      },
    ]);
  });

  it('SĐT dạng số do Sheets tự đổi vẫn chuẩn hóa đúng', () => {
    const result = mapRow(
      cells({
        'Tên khách hàng': 'Bình',
        'Số điện thoại': { text: '912345678', value: 912345678 },
      }),
      MAPPING,
      METADATA,
    );
    expect(result.phone).toBe('+84912345678');
  });

  it('các kiểu khác: ngày, số sai, trường đúng/sai, custom field nhiều giá trị, không khai lead_title', () => {
    const metadata = {
      ...METADATA,
      fields: {
        ...METADATA.fields,
        OPENED: { type: 'char' },
        UF_CRM_MULTI: {
          type: 'enumeration',
          isMultiple: true,
          items: [{ ID: '1', VALUE: 'A' }],
        },
      },
    };
    const mapping = {
      columns: [
        { header: 'Tên', field: 'NAME' },
        { header: 'Email', field: 'EMAIL' },
        { header: 'Ngày sinh', field: 'BIRTHDATE' },
        { header: 'Ngân sách', field: 'OPPORTUNITY' },
        { header: 'Công khai', field: 'OPENED' },
        { header: 'Nhóm', field: 'UF_CRM_MULTI' },
      ],
      duplicate_keys: ['EMAIL'],
    };
    const ok = mapRow(
      cells({
        Tên: 'An',
        Email: 'a@b.vn',
        'Ngày sinh': '15/10/2026',
        'Công khai': 'có',
        Nhóm: 'A',
      }),
      mapping,
      metadata,
    );
    expect(ok.payload).toMatchObject({
      BIRTHDATE: '2026-10-15',
      OPENED: 'Y',
      UF_CRM_MULTI: ['1'],
      TITLE: 'An',
    });

    const bad = mapRow(
      cells({
        Tên: 'An',
        Email: 'x',
        'Ngày sinh': 'hôm qua',
        'Ngân sách': 'nhiều',
      }),
      mapping,
      metadata,
    );
    expect(bad.issues.map((i) => i.message)).toEqual([
      'Email: email không hợp lệ',
      'Ngày sinh: không phải ngày hợp lệ',
      'Ngân sách: không phải số',
      'Cần có ít nhất một trong: Email',
    ]);
  });

  it('cùng một trường nhiều giá trị khai ở hai cột thì gộp, không trùng', () => {
    const mapping = {
      columns: [
        { header: 'SĐT 1', field: 'PHONE' },
        { header: 'SĐT 2', field: 'PHONE' },
      ],
      duplicate_keys: ['PHONE'],
    };
    const result = mapRow(
      cells({ 'SĐT 1': '0901234567', 'SĐT 2': '0912345678' }),
      mapping,
      METADATA,
    );
    expect(result.payload.PHONE).toEqual([
      { VALUE: '+84901234567', VALUE_TYPE: 'WORK' },
      { VALUE: '+84912345678', VALUE_TYPE: 'WORK' },
    ]);
    const invalid = mapRow(cells({ 'SĐT 1': 'abc' }), mapping, METADATA);
    expect(invalid.issues[0].message).toBe('SĐT 1: số điện thoại không hợp lệ');
  });
});
