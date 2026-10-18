<script setup lang="ts">
import { diffLines } from 'diff';
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client';
import type { MappingVersion } from '../api/types';
import { showApiError } from '../utils/errors';
import { canonicalJson, formatTime } from '../utils/format';

interface DiffLine {
  kind: 'add' | 'del' | 'same';
  text: string;
}

const versions = ref<MappingVersion[]>([]);
const selected = ref<number | ''>('');
const lines = ref<DiffLine[]>([]);
const compared = ref<{ from: number; to: number }>();

const latest = computed(() => versions.value[0]);
const older = computed(() => versions.value.slice(1));

/** So phiên bản đã chọn với phiên bản mới nhất, theo dòng (như diff của GitHub). */
async function compare() {
  if (selected.value === '' || !latest.value) return;
  try {
    const [from, to] = await Promise.all([api.mappingVersion(selected.value), api.mappingVersion(latest.value.version)]);
    lines.value = diffLines(canonicalJson(from.mappingJson), canonicalJson(to.mappingJson)).flatMap((part) =>
      part.value
        .replace(/\n$/, '')
        .split('\n')
        .map((text): DiffLine => ({ kind: part.added ? 'add' : part.removed ? 'del' : 'same', text })),
    );
    compared.value = { from: from.version, to: to.version };
  } catch (error) {
    showApiError('Không so sánh được', error);
  }
}

function reset() {
  selected.value = '';
  lines.value = [];
  compared.value = undefined;
}

onMounted(async () => {
  versions.value = await api.mappingVersions().catch((error: unknown) => {
    showApiError('Không tải được danh sách phiên bản', error);
    return [];
  });
});
</script>

<template>
  <div class="rounded-lg border border-slate-200 bg-white p-4">
    <div class="flex flex-wrap items-center gap-4 text-sm">
      <span>Current revision: <strong>{{ latest ? `v${latest.version}` : '—' }}</strong></span>
      <label class="flex items-center gap-2">
        Revision to compare
        <select v-model="selected" class="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="">— chọn —</option>
          <option v-for="v in older" :key="v.version" :value="v.version">v{{ v.version }} · {{ formatTime(v.createdAt) }}</option>
        </select>
      </label>
      <button
        class="rounded-md bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="selected === ''"
        @click="compare"
      >
        Compare
      </button>
      <button class="rounded-md border border-slate-300 px-4 py-1.5 hover:bg-slate-50 disabled:opacity-40" :disabled="selected === ''" @click="reset">
        Reset
      </button>
    </div>
    <p v-if="!older.length" class="mt-3 text-sm text-slate-500">Chưa có phiên bản cũ để so sánh.</p>
  </div>

  <div v-if="compared" class="mt-4">
    <p class="mb-2 text-sm text-slate-500">v{{ compared.from }} → v{{ compared.to }}: dòng đỏ bị xóa, dòng xanh được thêm.</p>
    <div class="overflow-auto rounded-lg border border-slate-200 bg-white py-2 font-mono text-[13px] leading-relaxed">
      <div
        v-for="(line, i) in lines"
        :key="i"
        class="whitespace-pre px-4"
        :class="{ 'bg-green-50 text-green-900': line.kind === 'add', 'bg-red-50 text-red-900': line.kind === 'del' }"
      >{{ line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  ' }}{{ line.text }}</div>
    </div>
  </div>
</template>
