<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string; label?: string }>();

const TONES: Record<string, string> = {
  SUCCESS: 'bg-green-100 text-green-700',
  DONE: 'bg-green-100 text-green-700',
  PARTIAL: 'bg-yellow-100 text-yellow-800',
  FAILED: 'bg-red-100 text-red-700',
  STALE: 'bg-red-100 text-red-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  RUNNING: 'bg-blue-100 text-blue-700',
};
const tone = computed(() => TONES[props.status] ?? 'bg-slate-100 text-slate-700');
</script>

<template>
  <span class="inline-block rounded-full px-2 py-0.5 text-xs font-semibold" :class="tone">{{ label ?? status }}</span>
</template>
