import { createRouter, createWebHashHistory } from 'vue-router';
import BatchRunsView from './views/BatchRunsView.vue';
import BatchesView from './views/BatchesView.vue';
import MappingView from './views/MappingView.vue';
import RunDetailView from './views/RunDetailView.vue';

/** Dùng hash (#/batches) để server chỉ cần phục vụ một tệp index.html. */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/batches' },
    { path: '/batches', component: BatchesView },
    { path: '/batches/:batch', component: BatchRunsView, props: true },
    { path: '/batches/:batch/runs/:uuid', component: RunDetailView, props: true },
    { path: '/mapping', component: MappingView },
  ],
});
