<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import type { Batch } from '../api/types';
import StatusBadge from '../components/StatusBadge.vue';
import { showMessage } from '../stores/dialogs';
import { showApiError } from '../utils/errors';
import { formatTime, timeUntil } from '../utils/format';

const router = useRouter();
const batches = ref<Batch[]>([]);
const loadError = ref('');
const running = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  try {
    batches.value = await api.batches();
    loadError.value = '';
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  }
}

async function runNow(event: Event, batch: Batch) {
  event.stopPropagation();
  running.value = batch.batch;
  try {
    const run = await api.runBatch(batch.batch);
    showMessage('Đã bắt đầu chạy', `Lần chạy ${run.runUuid.slice(0, 8)} của batch '${batch.name}' đang chạy nền. Xem kết quả trong lịch sử của batch.`);
    await load();
  } catch (error) {
    showApiError('Không chạy được', error);
  } finally {
    running.value = '';
  }
}

onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 10_000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <h2 class="text-xl font-semibold">Batches</h2>
  <p class="mt-1 text-sm text-slate-500">
    Các batch và lịch chạy. Batch Sheet → Bitrix24 dùng token Google do batch "Làm mới token Google" lưu. Tự làm mới mỗi 10 giây.
  </p>
  <p v-if="loadError" class="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{{ loadError }}</p>

  <div class="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white">
    <table class="w-full text-left text-sm">
      <thead class="bg-slate-50 text-slate-500">
        <tr>
          <th class="px-4 py-2 font-medium">Batch</th>
          <th class="px-4 py-2 font-medium">Chu kỳ</th>
          <th class="px-4 py-2 font-medium">Trạng thái</th>
          <th class="px-4 py-2 font-medium">Lần chạy gần nhất</th>
          <th class="px-4 py-2 font-medium">Lần chạy kế tiếp</th>
          <th class="px-4 py-2 font-medium">Giới hạn API tới</th>
          <th class="px-4 py-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="b in batches"
          :key="b.batch"
          class="cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50"
          @click="router.push(`/batches/${b.batch}`)"
        >
          <td class="px-4 py-3">
            <div class="font-medium text-slate-900">{{ b.name }}</div>
            <code class="text-xs text-slate-500">{{ b.batch }}</code>
          </td>
          <td class="px-4 py-3">{{ b.intervalSeconds / 60 }} phút</td>
          <td class="px-4 py-3">
            <StatusBadge :status="b.stale ? 'STALE' : b.status" />
            <div v-if="b.stale" class="mt-1 text-xs text-red-600">Không còn nhịp tim, có thể đã dừng đột ngột</div>
          </td>
          <td class="px-4 py-3">
            {{ formatTime(b.startedAt) }}
            <div class="text-xs text-slate-500">xong: {{ formatTime(b.finishedAt) }}</div>
          </td>
          <td class="px-4 py-3">{{ formatTime(b.nextRunAt) }}</td>
          <td class="px-4 py-3">
            <template v-if="b.cooldownUntil">
              {{ formatTime(b.cooldownUntil) }}
              <div class="text-xs text-slate-500">còn {{ timeUntil(b.cooldownUntil) }}</div>
            </template>
            <span v-else>—</span>
          </td>
          <td class="px-4 py-3 text-right">
            <button
              class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="!!running"
              @click="runNow($event, b)"
            >
              Chạy ngay
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
