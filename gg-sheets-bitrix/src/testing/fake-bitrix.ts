import type {
  BatchCommand,
  BatchResult,
  BitrixMultiField,
} from '../bitrix/types/bitrix.types';
import { ExternalApiError } from '../common/errors/external-api.error';

type Lead = Record<string, unknown> & { ID: number };

/**
 * Bitrix24 giả trong bộ nhớ cho test: crm.lead.list (lọc EMAIL/PHONE), add,
 * update (PHONE/EMAIL là thêm giá trị, đúng như Bitrix24), get. Có thể cài lỗi
 * cho các request batch kế tiếp bằng `failNext`.
 */
export class FakeBitrix {
  readonly leads = new Map<number, Lead>();
  readonly methods: string[] = [];
  readonly failNext: unknown[] = [];
  private nextId = 1;

  seed(fields: Record<string, unknown>): number {
    const id = this.nextId++;
    this.leads.set(id, { ...structuredClone(fields), ID: id });
    return id;
  }

  /** Như BitrixWebhookClient.call: lệnh lỗi thì ném lỗi. */
  call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const result = this.exec({ method, params });
    return result.ok
      ? Promise.resolve(result.result as T)
      : Promise.reject(result.error);
  }

  callBatch(
    commands: Record<string, BatchCommand>,
  ): Promise<Record<string, BatchResult>> {
    const failure = this.failNext.shift();
    if (failure)
      return Promise.reject(
        failure instanceof Error ? failure : new Error(JSON.stringify(failure)),
      );
    return Promise.resolve(
      Object.fromEntries(
        Object.entries(commands).map(([key, command]) => [
          key,
          this.exec(command),
        ]),
      ),
    );
  }

  private exec(command: BatchCommand): BatchResult {
    this.methods.push(command.method);
    const params = command.params as {
      id?: number;
      fields?: Record<string, unknown>;
      filter?: Record<string, string>;
    };
    switch (command.method) {
      case 'crm.lead.list': {
        const [[field, value]] = Object.entries(params.filter ?? {});
        const ids = [...this.leads.values()]
          .filter((lead) =>
            ((lead[field] as BitrixMultiField[] | undefined) ?? []).some(
              (v) => v.VALUE === value,
            ),
          )
          .map((lead) => ({ ID: String(lead.ID) }));
        return { ok: true, result: ids };
      }
      case 'crm.lead.add':
        return { ok: true, result: this.seed(params.fields ?? {}) };
      case 'crm.lead.update': {
        const lead = this.leads.get(Number(params.id));
        if (!lead) return notFound();
        for (const [field, value] of Object.entries(params.fields ?? {})) {
          lead[field] =
            Array.isArray(value) && Array.isArray(lead[field])
              ? [...(lead[field] as unknown[]), ...(value as unknown[])]
              : value;
        }
        return { ok: true, result: true };
      }
      case 'crm.lead.get': {
        const lead = this.leads.get(Number(params.id));
        return lead ? { ok: true, result: structuredClone(lead) } : notFound();
      }
      default:
        return {
          ok: false,
          error: new ExternalApiError(
            'bitrix24',
            'BAD_REQUEST',
            `method ${command.method}`,
          ),
        };
    }
  }
}

function notFound(): BatchResult {
  return {
    ok: false,
    error: new ExternalApiError('bitrix24', 'NOT_FOUND', 'Not found', {
      upstreamMessage: 'Not found',
    }),
  };
}
