import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

/**
 * Admin panel phục vụ tại /admin của ứng dụng NestJS (build ra ../public/admin).
 * `npm run dev`: chạy riêng ở cổng 5173, chuyển các API về backend.
 */
export default defineConfig({
  base: '/admin/',
  plugins: [vue(), tailwindcss()],
  build: { outDir: '../public/admin', emptyOutDir: true },
  server: {
    proxy: Object.fromEntries(['/sync', '/mapping', '/bitrix', '/google', '/health'].map((p) => [p, backend])),
  },
});
