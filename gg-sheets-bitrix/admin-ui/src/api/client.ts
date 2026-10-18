import { ref } from 'vue';
import { askApiKey } from '../stores/dialogs';
import type {
  Batch,
  ErrorBody,
  LeadField,
  MappingCurrent,
  MappingVersion,
  Rule,
  Run,
  RunAccepted,
} from './types';

const KEY = 'gg-sheets-bitrix.apiKey';

/** Có đang giữ API key không (để hiện nút "Đổi API key"). */
export const hasApiKey = ref(!!sessionStorage.getItem(KEY));

/**
 * API key chỉ cần khi backend có đặt API_KEY. Không hỏi trước: chỉ khi backend
 * trả 401 mới hỏi, và giữ key trong sessionStorage của tab trình duyệt.
 */
export const apiKey = {
  get: (): string => sessionStorage.getItem(KEY) ?? '',
  set: (value: string): void => {
    sessionStorage.setItem(KEY, value);
    hasApiKey.value = !!value;
  },
  clear: (): void => {
    sessionStorage.removeItem(KEY);
    hasApiKey.value = false;
  },
};

/** Lỗi trả về từ backend, giữ nguyên mã HTTP và body (errorKbn, details.errors). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = apiKey.get();
  const response = await fetch(path, {
    method,
    headers: { ...(key ? { 'x-api-key': key } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as ErrorBody;
  if (response.status === 401) {
    apiKey.clear();
    await askApiKey();
    return request<T>(method, path, body);
  }
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join('; ') : data.message;
    throw new ApiError(message || response.statusText, response.status, data);
  }
  return data as T;
}

export const api = {
  batches: () => request<Batch[]>('GET', '/sync/batches'),
  runBatch: (batch: string) => request<RunAccepted>('POST', `/sync/run?batch=${encodeURIComponent(batch)}`),
  runs: (batch: string, limit = 50) => request<Run[]>('GET', `/sync/runs?batch=${encodeURIComponent(batch)}&limit=${limit}`),
  run: (uuid: string) => request<Run>('GET', `/sync/runs/${uuid}`),
  mapping: () => request<MappingCurrent>('GET', '/mapping'),
  saveMapping: (baseVersion: number, mappingJson: unknown) =>
    request<{ version: number }>('PUT', '/mapping', { baseVersion, mappingJson }),
  mappingVersions: () => request<MappingVersion[]>('GET', '/mapping/versions'),
  mappingVersion: (version: number) => request<MappingVersion>('GET', `/mapping/versions/${version}`),
  rules: () => request<Rule[]>('GET', '/mapping/rules'),
  leadFields: () => request<LeadField[]>('GET', '/bitrix/lead-fields'),
};
