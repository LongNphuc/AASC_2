import type { BitrixMultiField } from '../../bitrix/types/bitrix.types';
import { withoutFields } from '../../mapping/helpers/ownership';
import type { LeadCommand, LeadRowInput } from '../types/lead.types';
import { multiFieldKey } from './multifield.mapper';

/** Lead có sẵn trên Bitrix24 tìm được theo email / SĐT. */
export interface ExistingLeads {
  byEmail: Map<string, number>;
  byPhone: Map<string, number>;
}

/**
 * Gom hàng theo lead đích để mỗi lead chỉ nhận một lệnh trong một lần chạy:
 * - hàng có Lead ID: gom theo Lead ID;
 * - hàng mới có chung email hoặc SĐT (bắc cầu) thuộc cùng một nhóm; nhóm khớp
 *   lead có sẵn (ưu tiên email, chọn ID nhỏ nhất) thì cập nhật lead đó, không
 *   khớp thì tạo mới;
 * - dữ liệu các hàng trong nhóm gộp theo thứ tự hàng: hàng nằm dưới thắng;
 * - `owned` (trường do Bitrix24 làm chủ) chỉ gửi khi tạo lead mới; lead đã có
 *   thì Bitrix24 giữ giá trị của nó.
 */
export function buildLeadCommands(
  updateRows: LeadRowInput[],
  newRows: LeadRowInput[],
  existing: ExistingLeads,
  owned: ReadonlySet<string> = new Set(),
): LeadCommand[] {
  const byTarget = new Map<number, LeadRowInput[]>();
  const actions = new Map<number, 'UPDATE' | 'LINK'>();
  const push = (
    target: number,
    row: LeadRowInput,
    action: 'UPDATE' | 'LINK',
  ) => {
    byTarget.set(target, [...(byTarget.get(target) ?? []), row]);
    actions.set(row.rowNumber, action);
  };
  for (const row of updateRows) push(row.leadId!, row, 'UPDATE');

  const creates: LeadRowInput[][] = [];
  for (const group of connectedGroups(newRows)) {
    const target = findTarget(group, existing);
    if (target === null) creates.push(group);
    else group.forEach((row) => push(target, row, 'LINK'));
  }

  const commands: LeadCommand[] = creates.map((group, index) => ({
    key: `c${index}`,
    target: null,
    payload: mergePayloads(group),
    rows: sorted(group).map((r) => ({
      rowNumber: r.rowNumber,
      action: 'CREATE' as const,
    })),
  }));
  for (const [target, rows] of byTarget) {
    commands.push({
      key: `u${target}`,
      target,
      payload: withoutFields(mergePayloads(rows), owned),
      rows: sorted(rows).map((r) => ({
        rowNumber: r.rowNumber,
        action: actions.get(r.rowNumber)!,
      })),
    });
  }
  return commands;
}

/** Các nhóm hàng mới nối với nhau qua email hoặc SĐT chung. */
export function connectedGroups(rows: LeadRowInput[]): LeadRowInput[][] {
  const parent = rows.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const owner = new Map<string, number>();
  rows.forEach((row, i) => {
    for (const key of [
      row.email && `e:${row.email}`,
      row.phone && `p:${row.phone}`,
    ]) {
      if (!key) continue;
      const j = owner.get(key);
      if (j === undefined) owner.set(key, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, LeadRowInput[]>();
  rows.forEach((row, i) =>
    groups.set(find(i), [...(groups.get(find(i)) ?? []), row]),
  );
  return [...groups.values()];
}

function findTarget(
  group: LeadRowInput[],
  existing: ExistingLeads,
): number | null {
  const pick = (ids: (number | undefined)[]) => {
    const found = ids.filter((id): id is number => id !== undefined);
    return found.length ? Math.min(...found) : null;
  };
  return (
    pick(
      group.map((r) => (r.email ? existing.byEmail.get(r.email) : undefined)),
    ) ??
    pick(
      group.map((r) => (r.phone ? existing.byPhone.get(r.phone) : undefined)),
    )
  );
}

function sorted(rows: LeadRowInput[]): LeadRowInput[] {
  return [...rows].sort((a, b) => a.rowNumber - b.rowNumber);
}

/** Gộp dữ liệu theo thứ tự hàng: hàng dưới ghi đè; SĐT/email gộp không trùng. */
export function mergePayloads(rows: LeadRowInput[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const row of sorted(rows)) {
    for (const [field, value] of Object.entries(row.payload)) {
      const current = merged[field];
      if (
        Array.isArray(current) &&
        Array.isArray(value) &&
        isMultiField(value)
      ) {
        const keys = new Set(
          (current as BitrixMultiField[]).map((v) =>
            multiFieldKey(field, v.VALUE),
          ),
        );
        merged[field] = [
          ...(current as BitrixMultiField[]),
          ...(value as BitrixMultiField[]).filter(
            (v) => !keys.has(multiFieldKey(field, v.VALUE)),
          ),
        ];
      } else {
        merged[field] = value;
      }
    }
  }
  return merged;
}

function isMultiField(value: unknown[]): boolean {
  return value.every((v) => !!v && typeof v === 'object' && 'VALUE' in v);
}
