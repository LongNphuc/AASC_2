import { ErrorKbn } from '../../common/kbn/error.kbn';
import { HEADERS, MAPPING, METADATA } from '../../testing/fixtures';
import { MappingValidatorService } from './mapping-validator.service';

describe('MappingValidatorService', () => {
  const validator = new MappingValidatorService();

  describe('tầng 1: cấu trúc', () => {
    it('mapping đúng thì trả config', () => {
      expect(validator.validateStructure(MAPPING)).toEqual({
        config: MAPPING,
        issues: [],
      });
    });

    it('không phải object', () => {
      expect(validator.validateStructure([]).issues[0].errorKbn).toBe(
        ErrorKbn.MAPPING_INVALID,
      );
      expect(validator.validateStructure(null).config).toBeUndefined();
    });

    it('báo đúng đường dẫn chỗ sai, kể cả luật không tồn tại và khóa lạ', () => {
      const { issues } = validator.validateStructure({
        columns: [
          { header: '', field: 'NAME' },
          { header: 'Email', field: 'email', rules: ['is_mail'] },
          { header: 'X', field: 'X', separator: ',' },
          { header: 'Y', field: 'Y', value_map: { a: 1 } },
        ],
        duplicate_keys: ['NAME'],
      });
      expect(issues.map((i) => i.path)).toEqual([
        'columns[0].header',
        'columns[1].field',
        'columns[2].separator',
        'duplicate_keys',
        'columns[1].rules',
        'columns[3].value_map',
      ]);
      expect(issues.find((i) => i.path === 'columns[1].rules')!.message).toBe(
        "columns[1].rules: luật 'is_mail' không tồn tại",
      );
    });

    it('thiếu columns', () => {
      const { issues } = validator.validateStructure({
        duplicate_keys: ['EMAIL'],
      });
      expect(issues[0]).toMatchObject({
        path: 'columns',
        message: 'columns: cần ít nhất một cột',
      });
    });
  });

  describe('tầng 2, 3: Sheet và Bitrix24', () => {
    it('mapping khớp Sheet và portal thì không có lỗi', () => {
      expect(validator.validateAgainst(MAPPING, HEADERS, METADATA)).toEqual([]);
    });

    it('báo cột thiếu trên Sheet, trường không có / chỉ đọc / kiểu chưa hỗ trợ, value_map sai', () => {
      const issues = validator.validateAgainst(
        {
          columns: [
            { header: 'Email', field: 'EMAIL' },
            { header: 'Cột lạ', field: 'NAME' },
            { header: 'Tên khách hàng', field: 'UF_CRM_123' },
            { header: 'Tên khách hàng', field: 'ID' },
            { header: 'Tên khách hàng', field: 'UF_CRM_FILE' },
            {
              header: 'Nguồn lead',
              field: 'SOURCE_ID',
              value_map: { website: 'ONLINE' },
            },
            {
              header: 'Lĩnh vực quan tâm',
              field: 'UF_CRM_INTEREST',
              value_map: { x: 'Giáo dục' },
            },
          ],
          duplicate_keys: ['EMAIL', 'PHONE'],
          lead_title: '{Tên khách hàng} - {Không có}',
        },
        HEADERS,
        METADATA,
      );
      expect(issues.map((i) => [i.path, i.errorKbn])).toEqual([
        ['columns[1].header', ErrorKbn.HEADER_MISSING],
        ['columns[2].field', ErrorKbn.FIELD_INVALID],
        ['columns[3].field', ErrorKbn.FIELD_INVALID],
        ['columns[4].field', ErrorKbn.FIELD_INVALID],
        ['columns[5].value_map', ErrorKbn.FIELD_INVALID],
        ['duplicate_keys', ErrorKbn.MAPPING_INVALID],
        ['lead_title', ErrorKbn.MAPPING_INVALID],
      ]);
      expect(issues[0].message).toBe(
        "Không tìm thấy cột 'Cột lạ' ở dòng 1 của Sheet",
      );
      expect(issues[3].message).toBe(
        'Trường UF_CRM_FILE có kiểu file, chưa hỗ trợ',
      );
    });

    it('một trường lấy từ nhiều cột: chặn trường thường và cột trùng hoàn toàn, cho phép PHONE/EMAIL và một cột nhiều trường', () => {
      const issues = validator.validateAgainst(
        {
          columns: [
            { header: 'Tên khách hàng', field: 'NAME' },
            { header: 'Email', field: 'EMAIL' },
            { header: 'Ghi chú', field: 'COMMENTS' },
            { header: 'Công ty', field: 'COMMENTS' },
            { header: 'Số điện thoại', field: 'PHONE' },
            { header: 'SĐT công ty', field: 'PHONE' },
            { header: 'Số điện thoại', field: 'PHONE' },
            { header: 'Nguồn lead', field: 'SOURCE_ID' },
            { header: 'Nguồn lead', field: 'UTM_SOURCE' },
          ],
          duplicate_keys: ['EMAIL', 'PHONE'],
        },
        [...HEADERS, 'SĐT công ty'],
        METADATA,
      );
      expect(issues).toEqual([
        {
          path: 'columns[3].field',
          errorKbn: ErrorKbn.MAPPING_INVALID,
          message:
            "Trường COMMENTS đã được ánh xạ ở columns[2] ('Ghi chú'): cột sau sẽ ghi đè cột trước. Chỉ trường nhiều giá trị (PHONE, EMAIL) mới được ánh xạ từ nhiều cột",
        },
        {
          path: 'columns[6].field',
          errorKbn: ErrorKbn.MAPPING_INVALID,
          message:
            'Trùng hoàn toàn với columns[4] (cùng tiêu đề, cùng trường): xóa bớt một cột',
        },
      ]);
    });
  });

  describe('owner: bitrix (đồng bộ hai chiều)', () => {
    it("owner chỉ nhận 'sheet' hoặc 'bitrix'", () => {
      const { issues } = validator.validateStructure({
        columns: [{ header: 'A', field: 'NAME', owner: 'crm' }],
        duplicate_keys: ['EMAIL'],
      });
      expect(issues).toEqual([
        {
          path: 'columns[0].owner',
          errorKbn: ErrorKbn.MAPPING_INVALID,
          message: "owner: chỉ nhận 'sheet' hoặc 'bitrix'",
        },
      ]);
    });

    it('trường tra trùng và kiểu chưa hỗ trợ không được để Bitrix24 làm chủ', () => {
      const metadata = {
        ...METADATA,
        fields: {
          ...METADATA.fields,
          WEB: { type: 'crm_multifield', isMultiple: true },
        },
      };
      const issues = validator.validateAgainst(
        {
          columns: [
            { header: 'Email', field: 'EMAIL', owner: 'bitrix' },
            { header: 'Ghi chú', field: 'WEB', owner: 'bitrix' },
            { header: 'Trạng thái', field: 'STATUS_ID', owner: 'bitrix' },
            {
              header: 'Người phụ trách',
              field: 'ASSIGNED_BY_ID',
              owner: 'bitrix',
            },
          ],
          duplicate_keys: ['EMAIL'],
        },
        HEADERS,
        metadata,
      );
      expect(issues.map((i) => [i.path, i.message])).toEqual([
        [
          'columns[0].owner',
          'EMAIL dùng để tra trùng nên không thể để Bitrix24 làm chủ (owner: bitrix)',
        ],
        [
          'columns[1].owner',
          'Trường WEB kiểu crm_multifield chưa hỗ trợ đồng bộ ngược (owner: bitrix)',
        ],
      ]);
    });
  });
});
