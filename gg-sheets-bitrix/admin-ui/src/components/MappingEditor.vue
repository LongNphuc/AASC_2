<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/client';
import type { LeadField, MappingCurrent, Rule } from '../api/types';
import { confirmDialog, showMessage } from '../stores/dialogs';
import { showApiError } from '../utils/errors';
import { canonicalJson, formatTime } from '../utils/format';

const emit = defineEmits<{ saved: [] }>();

const current = ref<MappingCurrent>();
const original = ref('');
const text = ref('');
const rules = ref<Rule[]>([]);
const fields = ref<LeadField[]>([]);
const sideError = ref('');
const saving = ref(false);

/** Parse JSON ngay khi gõ: lỗi cú pháp thì báo và khóa nút Save. */
const parsed = computed<{ value?: unknown; error?: string }>(() => {
  try {
    return { value: JSON.parse(text.value) as unknown };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
});
/** So sau khi sắp xếp khóa: đổi thứ tự khóa hay khoảng trắng không tính là sửa. */
const changed = computed(() => parsed.value.error === undefined && canonicalJson(parsed.value.value) !== original.value);

async function load() {
  current.value = await api.mapping();
  original.value = current.value.mappingJson ? canonicalJson(current.value.mappingJson) : '{}';
  text.value = original.value;
}

async function save() {
  if (!changed.value || !current.value) return;
  const base = current.value.version ?? 0;
  const ok = await confirmDialog('Lưu mapping', `Phiên bản ${base} → ${base + 1}, áp dụng từ lần chạy kế tiếp. Bạn chắc chứ?`);
  if (!ok) return;
  saving.value = true;
  try {
    const saved = await api.saveMapping(base, parsed.value.value);
    showMessage('Đã lưu', `Đã lưu mapping phiên bản ${saved.version}.`);
    emit('saved');
  } catch (error) {
    const conflict = error instanceof ApiError && error.status === 409;
    showApiError(conflict ? 'Mapping vừa được người khác sửa' : 'Lưu thất bại', error);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await load().catch((error: unknown) => showApiError('Không tải được mapping', error));
  const [rulesResult, fieldsResult] = await Promise.allSettled([api.rules(), api.leadFields()]);
  if (rulesResult.status === 'fulfilled') rules.value = rulesResult.value;
  if (fieldsResult.status === 'fulfilled') fields.value = fieldsResult.value.filter((f) => !f.isReadOnly);
  else sideError.value = fieldsResult.reason instanceof Error ? fieldsResult.reason.message : String(fieldsResult.reason);
});
</script>

<template>
  <div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div>
      <div class="mb-3 flex items-center gap-3">
        <span class="font-semibold">Phiên bản {{ current?.version ?? '—' }}</span>
        <span class="text-sm text-slate-500">{{ formatTime(current?.createdAt) }}</span>
        <span class="flex-1"></span>
        <button class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" :disabled="!changed" @click="text = original">
          Hoàn tác
        </button>
        <button
          class="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!changed || saving"
          @click="save"
        >
          Save
        </button>
      </div>
      <textarea
        v-model="text"
        spellcheck="false"
        class="h-[540px] w-full resize-y rounded-lg border bg-white p-3 font-mono text-[13px] leading-relaxed focus:outline-none"
        :class="parsed.error ? 'border-red-400' : 'border-slate-300 focus:border-blue-500'"
      ></textarea>
      <p v-if="parsed.error" class="mt-2 text-sm text-red-600">JSON không hợp lệ: {{ parsed.error }}</p>

      <div class="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <h3 class="text-sm font-semibold">Kiểm tra phiên bản đang dùng</h3>
        <ul v-if="current?.errors.length" class="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
          <li v-for="(e, i) in current.errors" :key="i">
            <code class="rounded bg-slate-100 px-1 text-xs text-slate-700">{{ e.path || '-' }}</code> {{ e.message }}
          </li>
        </ul>
        <p v-else class="mt-2 text-sm text-green-700">Mapping hợp lệ với Sheet và portal hiện tại.</p>
      </div>
    </div>

    <aside class="space-y-4">
      <div class="rounded-lg border border-slate-200 bg-white p-4">
        <h3 class="text-sm font-semibold">Luật được hỗ trợ</h3>
        <p class="mt-1 text-xs text-slate-500">Ghi vào <code>rules</code>, ví dụ <code>["is_not_blank"]</code></p>
        <ul class="mt-2 space-y-1 text-sm">
          <li v-for="r in rules" :key="r.name"><code class="text-xs text-blue-700">{{ r.name }}</code> {{ r.description }}</li>
        </ul>
      </div>
      <div class="rounded-lg border border-slate-200 bg-white p-4">
        <h3 class="text-sm font-semibold">Đồng bộ hai chiều</h3>
        <p class="mt-1 text-xs text-slate-500">
          Thêm <code>"owner": "bitrix"</code> vào cột do sales sửa trên CRM (ví dụ Trạng thái, Người phụ trách): giá trị
          chỉ gửi khi tạo lead; sau đó sales đổi trên Bitrix24 thì ứng dụng ghi về Sheet ngay (webhook). Cần
          <code>SYNC_DIRECTION=both</code> trong .env.
        </p>
      </div>
      <div class="rounded-lg border border-slate-200 bg-white p-4">
        <h3 class="text-sm font-semibold">Trường Bitrix24</h3>
        <p class="mt-1 text-xs text-slate-500">Ghi mã vào <code>field</code></p>
        <p v-if="sideError" class="mt-2 text-sm text-red-600">{{ sideError }}</p>
        <ul class="mt-2 max-h-80 space-y-1 overflow-auto text-sm">
          <li v-for="f in fields" :key="f.code">
            <code class="text-xs text-blue-700">{{ f.code }}</code> {{ f.title }}
            <span class="text-xs text-slate-400">{{ f.type }}</span>
          </li>
        </ul>
      </div>
    </aside>
  </div>
</template>
