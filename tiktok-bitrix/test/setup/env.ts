import { testEnv } from './test-env';

// Đặt trước khi nạp module của ứng dụng: cấu hình đọc process.env lúc khởi tạo.
Object.assign(process.env, testEnv());
