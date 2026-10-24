import { Injectable } from '@nestjs/common';
import {
  BitrixMockStore,
  ENTITY_CONTACT,
  ENTITY_DEAL,
  type MockFm,
  type MockItem,
  type MockLead,
  type MockMultiField,
} from './bitrix-mock.store';

/** Lỗi trả về như Bitrix24 thật: mã HTTP + { error, error_description }. */
export class MockBitrixError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly description: string,
  ) {
    super(description);
  }
}

type Params = Record<string, unknown>;

const notFound = () => new MockBitrixError(400, 'NOT_FOUND', 'Not found');
const now = () => new Date().toISOString();

/**
 * Các method Bitrix24 REST mà ứng dụng gọi (readme_api.md mục 9), làm đúng
 * những hành vi ứng dụng dựa vào: field nhiều giá trị không kèm ID là thêm,
 * crm.item.add ghi được leadId, crm.deal.add bỏ qua LEAD_ID (field chỉ đọc),
 * lệnh đọc bản ghi đã xóa báo "Not found".
 */
@Injectable()
export class BitrixMockMethods {
  constructor(private readonly store: BitrixMockStore) {}

  execute(method: string, params: Params): unknown {
    const handler = this.handlers[method.toLowerCase()];
    if (!handler) {
      throw new MockBitrixError(
        404,
        'ERROR_METHOD_NOT_FOUND',
        `Method not found: ${method}`,
      );
    }
    return handler(params);
  }

  private readonly handlers: Record<string, (params: Params) => unknown> = {
    'crm.lead.add': (p) => this.leadAdd(asRecord(p.fields)),
    'crm.lead.get': (p) => this.leadGet(Number(p.id ?? p.ID)),
    'crm.lead.update': (p) =>
      this.leadUpdate(Number(p.id ?? p.ID), asRecord(p.fields)),
    'crm.lead.list': (p) => this.leadList(asRecord(p.filter)),
    'crm.lead.fields': () => this.store.leadFields,
    'crm.lead.userfield.add': (p) => this.userFieldAdd(asRecord(p.fields)),
    'crm.deal.add': (p) => this.legacyDealAdd(asRecord(p.fields)),
    'crm.item.add': (p) =>
      this.itemAdd(Number(p.entityTypeId), asRecord(p.fields)),
    'crm.item.get': (p) => ({
      item: this.itemGet(Number(p.entityTypeId), Number(p.id)),
    }),
    'crm.item.update': (p) =>
      this.itemUpdate(Number(p.entityTypeId), Number(p.id), asRecord(p.fields)),
    'crm.item.list': (p) =>
      this.itemList(Number(p.entityTypeId), asRecord(p.filter)),
    'crm.duplicate.findbycomm': (p) => this.findByComm(p),
    'crm.timeline.comment.add': (p) => this.commentAdd(asRecord(p.fields)),
    'crm.settings.mode.get': () => 1,
    'crm.status.list': (p) => this.statusList(asRecord(p.filter)),
    'crm.status.add': (p) => this.statusAdd(asRecord(p.fields)),
    'crm.category.list': () => ({ categories: this.store.categories }),
    'crm.category.add': (p) => this.categoryAdd(asRecord(p.fields)),
    'crm.dealcategory.stage.list': (p) =>
      this.store.stagesOf(Number(p.id ?? 0)),
    'im.notify.system.add': (p) => this.notify(p),
    'user.get': () => this.store.users,
  };

  // --- lead (crm.lead.*) ---

  private leadAdd(fields: Params): number {
    const id = this.store.newLeadId();
    const lead: MockLead = {
      STATUS_ID: 'NEW',
      ...withoutMulti(fields),
      ID: str(id),
      EMAIL: [],
      PHONE: [],
      DATE_CREATE: now(),
      DATE_MODIFY: now(),
    };
    this.applyMulti(lead, fields);
    this.store.leads.set(id, lead);
    return id;
  }

  private leadGet(id: number): MockLead {
    const lead = this.store.leads.get(id);
    if (!lead) throw notFound();
    return lead;
  }

  private leadUpdate(id: number, fields: Params): boolean {
    const lead = this.leadGet(id);
    Object.assign(lead, withoutMulti(fields), { DATE_MODIFY: now() });
    this.applyMulti(lead, fields);
    return true;
  }

  private leadList(filter: Params): MockLead[] {
    return [...this.store.leads.values()].filter((lead) =>
      matchesFilter(lead, filter),
    );
  }

  /**
   * EMAIL, PHONE: giá trị không kèm ID là thêm; kèm ID là sửa; kèm ID và
   * DELETE = Y là xóa. Đây là lý do ứng dụng phải đọc lead trước khi cập nhật.
   */
  private applyMulti(lead: MockLead, fields: Params): void {
    for (const type of ['EMAIL', 'PHONE'] as const) {
      const values = fields[type];
      if (!Array.isArray(values)) continue;
      for (const raw of values as Params[]) {
        const existing = raw.ID
          ? lead[type].find((v) => v.ID === str(raw.ID))
          : undefined;
        if (existing && raw.DELETE === 'Y') {
          lead[type] = lead[type].filter((v) => v !== existing);
        } else if (existing) {
          existing.VALUE = str(raw.VALUE ?? existing.VALUE);
        } else if (raw.VALUE) {
          const value: MockMultiField = {
            ID: str(this.store.newMultiId()),
            VALUE: str(raw.VALUE),
            VALUE_TYPE: str(raw.VALUE_TYPE ?? 'WORK'),
            TYPE_ID: type,
          };
          lead[type].push(value);
        }
      }
    }
  }

  private userFieldAdd(fields: Params): number {
    const name = str(fields.FIELD_NAME ?? '');
    const code = name.startsWith('UF_CRM_') ? name : `UF_CRM_${name}`;
    this.store.leadFields[code] = {
      type: str(fields.USER_TYPE_ID ?? 'string'),
      title: str(fields.EDIT_FORM_LABEL ?? code),
      isRequired: false,
      isReadOnly: false,
      isMultiple: fields.MULTIPLE === 'Y',
    };
    return Object.keys(this.store.leadFields).length;
  }

  /** Method cũ: LEAD_ID là field chỉ đọc nên bị bỏ qua, như Bitrix24 thật. */
  private legacyDealAdd(fields: Params): number {
    const result = this.itemAdd(ENTITY_DEAL, {
      title: fields.TITLE,
      categoryId: fields.CATEGORY_ID ?? 0,
      stageId: fields.STAGE_ID,
    });
    return result.item.id;
  }

  // --- deal, Contact (crm.item.*) ---

  private itemAdd(entityTypeId: number, fields: Params): { item: MockItem } {
    const id = this.store.newItemId();
    const item: MockItem = {
      ...fields,
      id,
      entityTypeId,
      createdTime: now(),
      updatedTime: now(),
    };
    if (entityTypeId === ENTITY_DEAL) this.normalizeDeal(item);
    if (entityTypeId === ENTITY_CONTACT) {
      item.fm = this.mergeFm([], fields.fm);
      item.contactIds = undefined;
    }
    this.store.itemsOf(entityTypeId).set(id, item);
    return { item };
  }

  private itemGet(entityTypeId: number, id: number): MockItem {
    const item = this.store.itemsOf(entityTypeId).get(id);
    if (!item) throw notFound();
    return item;
  }

  private itemUpdate(
    entityTypeId: number,
    id: number,
    fields: Params,
  ): { item: MockItem } {
    const item = this.itemGet(entityTypeId, id);
    const { fm, ...rest } = fields;
    Object.assign(item, rest, { updatedTime: now() });
    if (entityTypeId === ENTITY_CONTACT && fm !== undefined) {
      item.fm = this.mergeFm(item.fm as MockFm[], fm);
    }
    if (entityTypeId === ENTITY_DEAL) this.normalizeDeal(item);
    return { item };
  }

  private itemList(
    entityTypeId: number,
    filter: Params,
  ): { items: MockItem[] } {
    return {
      items: [...this.store.itemsOf(entityTypeId).values()].filter((item) =>
        matchesFilter(item, filter),
      ),
    };
  }

  /** Stage đầy đủ theo pipeline, nhóm stage (P/S/F), trạng thái đóng. */
  normalizeDeal(item: MockItem): void {
    const categoryId = Number(item.categoryId ?? 0);
    item.categoryId = categoryId;
    const stage = str(item.stageId ?? this.store.stageCode(categoryId, 'NEW'));
    item.stageId = stage;
    item.stageSemanticId = this.store.stageSemantic(stage);
    item.closed = item.stageSemanticId === 'P' ? 'N' : 'Y';
    if (item.closed === 'Y' && !item.closedate) item.closedate = now();
    item.opportunity = Number(item.opportunity ?? 0);
    item.probability = Number(item.probability ?? 0);
  }

  /** fm của Contact: kèm id là sửa giá trị đó, không kèm id là thêm (giá trị cũ giữ nguyên). */
  private mergeFm(existing: MockFm[], incoming: unknown): MockFm[] {
    const result = [...(existing ?? [])];
    for (const raw of (Array.isArray(incoming) ? incoming : []) as Params[]) {
      const found = raw.id
        ? result.find((v) => v.id === Number(raw.id))
        : undefined;
      if (found) {
        found.value = str(raw.value ?? found.value);
      } else if (raw.value) {
        result.push({
          id: this.store.newMultiId(),
          typeId: raw.typeId === 'PHONE' ? 'PHONE' : 'EMAIL',
          valueType: str(raw.valueType ?? 'WORK'),
          value: str(raw.value),
        });
      }
    }
    return result;
  }

  // --- tra trùng ---

  private findByComm(p: Params): Record<string, number[]> | [] {
    const entityType = str(p.entity_type ?? 'LEAD').toUpperCase();
    const type = str(p.type ?? 'EMAIL').toUpperCase();
    const values = (Array.isArray(p.values) ? p.values : [p.values])
      .filter(Boolean)
      .map((v) => normalizeComm(type, str(v)));
    if (values.length === 0) return [];
    const ids: number[] = [];
    if (entityType === 'LEAD') {
      for (const lead of this.store.leads.values()) {
        const own = (type === 'PHONE' ? lead.PHONE : lead.EMAIL).map((v) =>
          normalizeComm(type, v.VALUE),
        );
        if (own.some((v) => values.includes(v))) ids.push(Number(lead.ID));
      }
    } else if (entityType === 'CONTACT') {
      for (const item of this.store.itemsOf(ENTITY_CONTACT).values()) {
        const own = ((item.fm as MockFm[]) ?? [])
          .filter((v) => v.typeId === type)
          .map((v) => normalizeComm(type, v.value));
        if (own.some((v) => values.includes(v))) ids.push(item.id);
      }
    }
    return ids.length ? { [entityType]: ids } : [];
  }

  // --- timeline, trạng thái, thông báo ---

  private commentAdd(fields: Params): number {
    const entityType = str(fields.ENTITY_TYPE ?? '').toLowerCase();
    const entityId = Number(fields.ENTITY_ID);
    const exists =
      entityType === 'lead'
        ? this.store.leads.has(entityId)
        : entityType === 'deal'
          ? this.store.itemsOf(ENTITY_DEAL).has(entityId)
          : entityType === 'contact'
            ? this.store.itemsOf(ENTITY_CONTACT).has(entityId)
            : false;
    if (!exists) throw notFound();
    const id = this.store.newCommentId();
    this.store.comments.push({
      id,
      ENTITY_TYPE: entityType,
      ENTITY_ID: entityId,
      COMMENT: str(fields.COMMENT ?? ''),
      CREATED: now(),
    });
    return id;
  }

  private statusList(filter: Params) {
    const entityId = filter.ENTITY_ID ? str(filter.ENTITY_ID) : undefined;
    const match = /^DEAL_STAGE(?:_(\d+))?$/.exec(entityId ?? '');
    if (match) {
      return this.store
        .stagesOf(Number(match[1] ?? 0))
        .map((s) => ({ ...s, ENTITY_ID: entityId, NAME: s.STATUS_ID }));
    }
    return this.store.statuses.filter(
      (s) => !entityId || s.ENTITY_ID === entityId,
    );
  }

  private statusAdd(fields: Params): number {
    this.store.statuses.push({
      ENTITY_ID: str(fields.ENTITY_ID ?? ''),
      STATUS_ID: str(fields.STATUS_ID ?? ''),
      NAME: str(fields.NAME ?? fields.STATUS_ID ?? ''),
    });
    return this.store.statuses.length;
  }

  private categoryAdd(fields: Params): { category: { id: number } } {
    const id = Math.max(...this.store.categories.map((c) => c.id)) + 1;
    this.store.categories.push({ id, name: str(fields.name ?? id) });
    return { category: { id } };
  }

  /** Gửi lại cùng TAG thì thay thông báo cũ, như Bitrix24 thật. */
  private notify(p: Params): number {
    const tag = p.TAG ? str(p.TAG) : undefined;
    if (tag) {
      this.store.notifications = this.store.notifications.filter(
        (n) => n.TAG !== tag,
      );
    }
    const id = this.store.newNotifyId();
    this.store.notifications.push({
      id,
      USER_ID: Number(p.USER_ID),
      MESSAGE: str(p.MESSAGE ?? ''),
      TAG: tag,
      CREATED: now(),
    });
    return id;
  }
}

/** Giá trị tham số (chuỗi hoặc số, sau khi parse JSON hay query string) thành chuỗi. */
function str(value: unknown): string {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : '';
}

function asRecord(value: unknown): Params {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Params)
    : {};
}

function withoutMulti(fields: Params): Params {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { EMAIL, PHONE, ID, ...rest } = fields;
  return rest;
}

/** So email không phân biệt hoa thường; SĐT so 9 chữ số cuối (+84… và 0… là một). */
function normalizeComm(type: string, value: string): string {
  if (type === 'PHONE') return value.replace(/\D/g, '').slice(-9);
  return value.trim().toLowerCase();
}

/** Lọc bằng nhau theo từng khóa; bỏ tiền tố toán tử (=, @) của Bitrix24; mảng là IN. */
function matchesFilter(record: Params, filter: Params): boolean {
  return Object.entries(filter).every(([rawKey, expected]) => {
    const key = rawKey.replace(/^[=@!<>]+/, '');
    const actual = record[key];
    if (Array.isArray(expected)) {
      return expected.map(String).includes(str(actual));
    }
    return str(actual ?? '') === str(expected ?? '');
  });
}
