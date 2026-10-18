<script setup lang="ts">
import { ref } from 'vue';
import MappingCompare from '../components/MappingCompare.vue';
import MappingEditor from '../components/MappingEditor.vue';

const tab = ref<'edit' | 'compare'>('edit');
/** Đổi key sau khi lưu để cả hai tab tải lại phiên bản mới nhất. */
const reloadKey = ref(0);
const tabs = [
  { id: 'edit', label: 'View & Edit' },
  { id: 'compare', label: 'Compare' },
] as const;
</script>

<template>
  <h2 class="text-xl font-semibold">Mapping Rules</h2>
  <p class="mt-1 text-sm text-slate-500">Cột trên Google Sheet ↔ trường trên Bitrix24. Mỗi lần lưu tạo một phiên bản mới.</p>

  <div class="mt-5 flex gap-1 border-b border-slate-200">
    <button
      v-for="t in tabs"
      :key="t.id"
      class="-mb-px border-b-2 px-4 py-2 text-sm"
      :class="tab === t.id ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'"
      @click="tab = t.id"
    >
      {{ t.label }}
    </button>
  </div>

  <div class="mt-5">
    <MappingEditor v-show="tab === 'edit'" :key="`edit-${reloadKey}`" @saved="reloadKey++" />
    <MappingCompare v-show="tab === 'compare'" :key="`compare-${reloadKey}`" />
  </div>
</template>
