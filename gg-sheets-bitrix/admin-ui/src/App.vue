<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import AppDialogs from './components/AppDialogs.vue';
import { hasApiKey } from './api/client';
import { askApiKey } from './stores/dialogs';

const nav = [
  { to: '/batches', label: 'Batches' },
  { to: '/mapping', label: 'Mapping Rules' },
];
</script>

<template>
  <div class="min-h-screen">
    <!-- Thanh bên trái cố định -->
    <aside class="fixed inset-y-0 left-0 flex w-56 flex-col border-r border-slate-200 bg-white px-3 py-4">
      <div class="px-2 pb-4 text-sm font-bold text-slate-900">Sheets → Bitrix24</div>
      <nav class="flex flex-col gap-1">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700"
          active-class="bg-blue-50 font-medium text-blue-700"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
      <button v-if="hasApiKey" class="mt-auto px-3 py-2 text-left text-sm text-blue-600 hover:underline" @click="askApiKey()">
        Đổi API key
      </button>
    </aside>

    <main class="ml-56 max-w-6xl px-8 py-6">
      <RouterView />
    </main>

    <AppDialogs />
  </div>
</template>
