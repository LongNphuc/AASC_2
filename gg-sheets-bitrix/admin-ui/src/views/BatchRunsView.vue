<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '../api/client';
import { isRowSummary, type Run } from '../api/types';
import StatusBadge from '../components/StatusBadge.vue';
import { formatTime, triggerLabel } from '../utils/format';

const props = defineProps<{ batch: string }>();
const router = useRouter();
const runs = ref<Run[]>([]);
const loadError = ref('');

/** Viền trái của mỗi dòng theo kết quả lần chạy. */
const BORDER: Record<string, string> = {
  SUCCESS: 'border-l-green-600',
  PARTIAL: 'border-l-yellow-500',
  FAILED: 'border-l-red-600',
  PROCESSING: 'border-l-blue-600',
};

onMounted(async () => {
  try {
    runs.value = await api.runs(props.batch);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  }
});
</script>

<template>
  <RouterLink to="/batches" class="text-sm text-blue-600 hover:underline">← Batches</RouterLink>
  <h2 class="mt-2 text-xl font-semibold">Lịch sử chạy</h2>
  <p class="mt-1 text-sm text-slate-500"><code>{{ batch }}</code> · 50 lần gần nhất</p>
  <p v-if="loadError" class="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{{ loadError }}</p>

  <div class="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white">
    <table class="w-full text-left text-sm">
      <thead class="bg-slate-50 text-slate-500">
        <tr>
          <th class="px-4 py-2 font-medium">Bắt đầu</th>
          <th class="px-4 py-2 font-medium">Kết quả</th>
          <th class="px-4 py-2 font-medium">Kích hoạt</th>
          <th class="px-4 py-2 font-medium">Mapping</th>
          <th class="px-4 py-2 font-medium">Tổng kết</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in runs"
          :key="r.uuid"
          class="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
          @click="router.push(`/batches/${batch}/runs/${r.uuid}`)"
        >
          <td class="border-l-4 px-4 py-3" :class="BORDER[r.status]">{{ formatTime(r.startedAt) }}</td>
          <td class="px-4 py-3"><StatusBadge :status="r.status" /></td>
          <td class="px-4 py-3">{{ triggerLabel(r.trigger) }}</td>
          <td class="px-4 py-3">{{ r.mappingVersion ? `v${r.mappingVersion}` : '—' }}</td>
          <td class="px-4 py-3">
            <template v-if="isRowSummary(r.summary)">
              {{ r.summary.total_rows }} hàng · tạo {{ r.summary.upload_succeeded.created }} · cập nhật
              {{ r.summary.upload_succeeded.updated }} · bỏ qua {{ r.summary.skipped_rows }} · sai {{ r.summary.invalid_rows }} ·
              lỗi {{ r.summary.upload_failed }} · chờ {{ r.summary.pending_rows }}
            </template>
            <template v-else-if="r.summary">
              Token mới của {{ r.summary.account_email ?? '—' }}, hết hạn {{ formatTime(r.summary.expires_at) }}
            </template>
            <span v-else class="text-slate-500">{{ r.errorDetail ?? '—' }}</span>
          </td>
        </tr>
        <tr v-if="!runs.length && !loadError">
          <td colspan="5" class="px-4 py-6 text-center text-slate-500">Chưa có lần chạy nào</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
