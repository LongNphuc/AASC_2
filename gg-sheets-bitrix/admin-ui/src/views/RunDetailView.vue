<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../api/client';
import { isRowSummary, type Run } from '../api/types';
import StatusBadge from '../components/StatusBadge.vue';
import { compactRanges, formatTime, timeUntil, triggerLabel } from '../utils/format';

const props = defineProps<{ batch: string; uuid: string }>();
const run = ref<Run>();
const loadError = ref('');
const tab = ref<'summary' | 'problems'>('summary');

/** Loại hàng có vấn đề (status_kbn), theo thứ tự hiển thị. */
const KIND: Record<number, { label: string; status: string; hint: string }> = {
  10006: { label: 'Dữ liệu sai', status: 'FAILED', hint: 'Sửa dữ liệu trên Sheet; lần chạy sau tự gửi lại' },
  10001: { label: 'Bitrix24 từ chối', status: 'FAILED', hint: 'Bitrix24 không nhận dữ liệu của hàng' },
  10005: { label: 'Chưa gửi', status: 'PARTIAL', hint: 'Chưa gửi được (quá tải, hết giờ); lần chạy sau gửi lại' },
};
const KIND_ORDER = [10006, 10001, 10005];

interface ProblemLine {
  row: number;
  name: string;
  lead_id?: number;
  error_kbn: number;
  message: string;
  retry_after?: string;
}

/**
 * problem_rows trong DB gom theo (loại, mã lỗi, lý do) cho gọn. Ở đây gom lại
 * theo loại: mỗi loại một bảng, mỗi hàng một dòng kèm mã lỗi và lý do riêng.
 */
const sections = computed(() => {
  const byKind = new Map<number, ProblemLine[]>();
  for (const g of run.value?.problem_rows ?? []) {
    const lines = byKind.get(g.status_kbn) ?? [];
    for (const r of g.rows) lines.push({ ...r, error_kbn: g.error_kbn, message: g.message, retry_after: g.retry_after });
    byKind.set(g.status_kbn, lines);
  }
  return [...byKind.entries()]
    .sort(([a], [b]) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))
    .map(([kbn, lines]) => ({
      kbn,
      label: KIND[kbn]?.label ?? String(kbn),
      status: KIND[kbn]?.status ?? 'FAILED',
      hint: KIND[kbn]?.hint ?? '',
      lines: lines.sort((x, y) => x.row - y.row),
      hasLead: lines.some((l) => l.lead_id),
      hasRetry: lines.some((l) => l.retry_after),
    }));
});

const stats = computed(() => {
  const s = run.value?.summary;
  if (!isRowSummary(s)) return [];
  return [
    { label: 'Đọc từ Sheet', value: s.total_rows },
    { label: 'Không đổi (bỏ qua)', value: s.skipped_rows },
    { label: 'Dữ liệu sai', value: s.invalid_rows },
    { label: 'Tạo lead mới', value: s.upload_succeeded.created },
    { label: 'Cập nhật lead', value: s.upload_succeeded.updated },
    { label: 'Bitrix24 từ chối', value: s.upload_failed },
    { label: 'Chưa gửi (chờ)', value: s.pending_rows },
  ];
});
const token = computed(() => {
  const s = run.value?.summary;
  return s && !isRowSummary(s) ? s : null;
});
const isTokenBatch = computed(() => props.batch === 'GOOGLE_TOKEN_REFRESH');
const problemCount = computed(() => (run.value?.problem_rows ?? []).reduce((n, g) => n + g.rows.length, 0));

onMounted(async () => {
  try {
    run.value = await api.run(props.uuid);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  }
});
</script>

<template>
  <RouterLink :to="`/batches/${batch}`" class="text-sm text-blue-600 hover:underline">← Lịch sử chạy</RouterLink>
  <p v-if="loadError" class="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{{ loadError }}</p>

  <template v-if="run">
    <h2 class="mt-2 flex items-center gap-3 text-xl font-semibold">
      Lần chạy {{ uuid.slice(0, 8) }} <StatusBadge :status="run.status" />
    </h2>
    <p class="mt-1 text-sm text-slate-500">
      {{ triggerLabel(run.trigger) }}<template v-if="run.mappingVersion"> · mapping v{{ run.mappingVersion }}</template> ·
      {{ formatTime(run.startedAt) }} → {{ formatTime(run.finishedAt) }}
    </p>
    <div v-if="run.errorDetail" class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span class="font-medium">Lý do:</span> {{ run.errorDetail }}
      <span class="text-red-600">(error_kbn {{ run.errorKbn }})</span>
    </div>

    <div v-if="isTokenBatch" class="mt-5">
      <dl v-if="token" class="grid max-w-xl grid-cols-[10rem_1fr] gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <dt class="text-slate-500">Tài khoản</dt>
        <dd>{{ token.account_email ?? '—' }}</dd>
        <dt class="text-slate-500">Token hết hạn lúc</dt>
        <dd>{{ formatTime(token.expires_at) }}</dd>
      </dl>
      <p v-else class="text-sm text-slate-500">Chưa lấy được token mới; batch Sheet → Bitrix24 vẫn dùng token cũ nếu còn hạn.</p>
    </div>

    <template v-else>
      <div class="mt-5 flex gap-1 border-b border-slate-200">
        <button
          v-for="t in [{ id: 'summary', label: 'Summary' }, { id: 'problems', label: `Problem rows (${problemCount})` }]"
          :key="t.id"
          class="-mb-px border-b-2 px-4 py-2 text-sm"
          :class="tab === t.id ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'"
          @click="tab = t.id as 'summary' | 'problems'"
        >
          {{ t.label }}
        </button>
      </div>

      <div v-if="tab === 'summary'" class="mt-5">
        <div v-if="stats.length" class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <div v-for="s in stats" :key="s.label" class="rounded-lg border border-slate-200 bg-white p-3">
            <div class="text-xs text-slate-500">{{ s.label }}</div>
            <div class="mt-1 text-2xl font-semibold">{{ s.value }}</div>
          </div>
        </div>
        <p v-else class="text-sm text-slate-500">Lần chạy dừng trước khi xử lý hàng.</p>
      </div>

      <div v-else class="mt-5 space-y-6">
        <section v-for="s in sections" :key="s.kbn">
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge :status="s.status" :label="s.label" />
            <span class="font-medium">{{ s.lines.length }} hàng</span>
            <span class="text-slate-500">· Hàng {{ compactRanges(s.lines.map((l) => l.row)) }} · {{ s.hint }}</span>
          </div>
          <div class="mt-2 max-h-[28rem] overflow-auto rounded-lg border border-slate-200 bg-white">
            <table class="w-full text-left text-sm">
              <thead class="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th class="w-16 px-4 py-2 font-medium">Hàng</th>
                  <th class="px-4 py-2 font-medium">Khách hàng</th>
                  <th v-if="s.hasLead" class="w-24 px-4 py-2 font-medium">Lead ID</th>
                  <th class="w-24 px-4 py-2 font-medium">Mã lỗi</th>
                  <th class="px-4 py-2 font-medium">Lý do</th>
                  <th v-if="s.hasRetry" class="w-32 px-4 py-2 font-medium">Gọi lại sau</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="l in s.lines" :key="l.row" class="border-t border-slate-100 align-top">
                  <td class="px-4 py-2">{{ l.row }}</td>
                  <td class="px-4 py-2">{{ l.name || '—' }}</td>
                  <td v-if="s.hasLead" class="px-4 py-2">{{ l.lead_id ?? '—' }}</td>
                  <td class="px-4 py-2"><code class="rounded bg-slate-100 px-1 text-xs">{{ l.error_kbn }}</code></td>
                  <td class="px-4 py-2">{{ l.message }}</td>
                  <td v-if="s.hasRetry" class="px-4 py-2">{{ l.retry_after ? timeUntil(l.retry_after) : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <p v-if="!problemCount" class="text-sm text-slate-500">Không có hàng nào có vấn đề.</p>
      </div>
    </template>
  </template>
</template>
