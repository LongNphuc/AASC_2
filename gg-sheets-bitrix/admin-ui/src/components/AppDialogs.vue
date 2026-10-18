<script setup lang="ts">
import { ref, watch } from 'vue';
import { apiKey } from '../api/client';
import { dialogs } from '../stores/dialogs';

const keyInput = ref('');
watch(
  () => dialogs.apiKey.open,
  (open) => {
    if (open) keyInput.value = apiKey.get();
  },
);

function saveKey() {
  if (!keyInput.value) return;
  apiKey.set(keyInput.value);
  dialogs.apiKey.open = false;
  dialogs.apiKey.resolve();
}

function answer(ok: boolean) {
  dialogs.confirm.open = false;
  dialogs.confirm.resolve(ok);
}
</script>

<template>
  <!-- Nhập API key -->
  <div v-if="dialogs.apiKey.open" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
    <form class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" @submit.prevent="saveKey">
      <h3 class="text-base font-semibold">Nhập API key</h3>
      <p class="mt-1 text-sm text-slate-500">Server đang bật bảo vệ bằng API_KEY. Nhập giá trị API_KEY trong .env; chỉ giữ trong tab trình duyệt này.</p>
      <input
        v-model="keyInput"
        type="password"
        autocomplete="off"
        autofocus
        class="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <div class="mt-5 flex justify-end">
        <button type="submit" class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Lưu</button>
      </div>
    </form>
  </div>

  <!-- Xác nhận -->
  <div v-if="dialogs.confirm.open" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
    <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
      <h3 class="text-base font-semibold">{{ dialogs.confirm.title }}</h3>
      <p class="mt-2 text-sm text-slate-600">{{ dialogs.confirm.text }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button class="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50" @click="answer(false)">Hủy</button>
        <button class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700" @click="answer(true)">Đồng ý</button>
      </div>
    </div>
  </div>

  <!-- Thông báo kết quả -->
  <div v-if="dialogs.message.open" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
    <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
      <h3 class="text-base font-semibold" :class="dialogs.message.tone === 'error' ? 'text-red-700' : 'text-slate-900'">
        {{ dialogs.message.title }}
      </h3>
      <p class="mt-2 text-sm text-slate-600">{{ dialogs.message.text }}</p>
      <ul v-if="dialogs.message.errors.length" class="mt-3 max-h-64 list-disc space-y-1 overflow-auto pl-5 text-sm text-red-700">
        <li v-for="(issue, i) in dialogs.message.errors" :key="i">
          <code class="rounded bg-slate-100 px-1 text-xs text-slate-700">{{ issue.path || '-' }}</code>
          {{ issue.message }}
        </li>
      </ul>
      <div class="mt-5 flex justify-end">
        <button class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700" @click="dialogs.message.open = false">
          Đóng
        </button>
      </div>
    </div>
  </div>
</template>
