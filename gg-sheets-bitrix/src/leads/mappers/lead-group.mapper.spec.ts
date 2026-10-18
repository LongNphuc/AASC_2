import type { LeadRowInput } from '../types/lead.types';
import {
  buildLeadCommands,
  connectedGroups,
  mergePayloads,
} from './lead-group.mapper';

const phone = (value: string) => [{ VALUE: value, VALUE_TYPE: 'WORK' }];
const none = {
  byEmail: new Map<string, number>(),
  byPhone: new Map<string, number>(),
};

describe('lead-group.mapper', () => {
  it('ví dụ trong tài liệu: hai hàng cùng SĐT → một lead; hàng trùng lead có sẵn → LINK', () => {
    const rows: LeadRowInput[] = [
      {
        rowNumber: 2,
        payload: { NAME: 'An', OPPORTUNITY: 50 },
        email: 'a@abc.vn',
        phone: '+84901234567',
      },
      { rowNumber: 3, payload: { NAME: 'C' }, email: 'c@xyz.vn' },
      {
        rowNumber: 4,
        payload: { NAME: 'An', OPPORTUNITY: 80 },
        phone: '+84901234567',
      },
    ];
    const existing = {
      byEmail: new Map([['c@xyz.vn', 98]]),
      byPhone: new Map<string, number>(),
    };

    const commands = buildLeadCommands([], rows, existing);

    expect(commands).toEqual([
      {
        key: 'c0',
        target: null,
        payload: { NAME: 'An', OPPORTUNITY: 80 },
        rows: [
          { rowNumber: 2, action: 'CREATE' },
          { rowNumber: 4, action: 'CREATE' },
        ],
      },
      {
        key: 'u98',
        target: 98,
        payload: { NAME: 'C' },
        rows: [{ rowNumber: 3, action: 'LINK' }],
      },
    ]);
  });

  it('hàng có Lead ID và hàng mới trùng cùng lead gộp thành một lệnh', () => {
    const commands = buildLeadCommands(
      [{ rowNumber: 5, payload: { NAME: 'X', COMMENTS: 'cũ' }, leadId: 7 }],
      [{ rowNumber: 9, payload: { COMMENTS: 'mới' }, email: 'x@x.vn' }],
      { byEmail: new Map([['x@x.vn', 7]]), byPhone: new Map() },
    );
    expect(commands).toEqual([
      {
        key: 'u7',
        target: 7,
        payload: { NAME: 'X', COMMENTS: 'mới' },
        rows: [
          { rowNumber: 5, action: 'UPDATE' },
          { rowNumber: 9, action: 'LINK' },
        ],
      },
    ]);
  });

  it('nhiều lead khớp: ưu tiên email, chọn ID nhỏ nhất', () => {
    const commands = buildLeadCommands(
      [],
      [
        { rowNumber: 2, payload: {}, email: 'a@a.vn', phone: '+84900000001' },
        { rowNumber: 3, payload: {}, email: 'b@b.vn' },
      ],
      {
        byEmail: new Map([
          ['a@a.vn', 30],
          ['b@b.vn', 20],
        ]),
        byPhone: new Map([['+84900000001', 5]]),
      },
    );
    // Hàng 2 khớp email (lead 30) và SĐT (lead 5): ưu tiên email → 30.
    expect(commands.map((c) => [c.rows[0].rowNumber, c.target])).toEqual([
      [2, 30],
      [3, 20],
    ]);
  });

  it('nhóm bắc cầu: A–B chung email, B–C chung SĐT → một nhóm', () => {
    const groups = connectedGroups([
      { rowNumber: 2, payload: {}, email: 'a@a.vn' },
      { rowNumber: 3, payload: {}, email: 'a@a.vn', phone: '+84900000001' },
      { rowNumber: 4, payload: {}, phone: '+84900000001' },
      { rowNumber: 5, payload: {}, email: 'z@z.vn' },
    ]);
    expect(groups.map((g) => g.map((r) => r.rowNumber))).toEqual([
      [2, 3, 4],
      [5],
    ]);
  });

  it('gộp payload: hàng dưới thắng; SĐT/email gộp không trùng', () => {
    expect(
      mergePayloads([
        { rowNumber: 4, payload: { NAME: 'Mới', PHONE: phone('0901234567') } },
        {
          rowNumber: 2,
          payload: {
            NAME: 'Cũ',
            PHONE: phone('+84901234567'),
            COMPANY_TITLE: 'ABC',
          },
        },
      ]),
    ).toEqual({
      NAME: 'Mới',
      PHONE: phone('+84901234567'),
      COMPANY_TITLE: 'ABC',
    });
  });

  it('không có hàng nào thì không có lệnh', () => {
    expect(buildLeadCommands([], [], none)).toEqual([]);
  });

  it('trường do Bitrix24 làm chủ chỉ gửi khi tạo lead; UPDATE và LINK thì bỏ', () => {
    const commands = buildLeadCommands(
      [{ rowNumber: 2, payload: { NAME: 'An', STATUS_ID: 'NEW' }, leadId: 5 }],
      [
        {
          rowNumber: 3,
          payload: { NAME: 'B', STATUS_ID: 'NEW' },
          email: 'b@x.vn',
        },
        {
          rowNumber: 4,
          payload: { NAME: 'C', STATUS_ID: 'NEW' },
          email: 'c@x.vn',
        },
      ],
      { byEmail: new Map([['c@x.vn', 9]]), byPhone: new Map() },
      new Set(['STATUS_ID']),
    );
    expect(Object.fromEntries(commands.map((c) => [c.key, c.payload]))).toEqual(
      {
        c0: { NAME: 'B', STATUS_ID: 'NEW' },
        u5: { NAME: 'An' },
        u9: { NAME: 'C' },
      },
    );
  });
});
