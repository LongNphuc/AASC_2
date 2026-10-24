import type { DataSourceOptions } from 'typeorm';

/**
 * Cấu hình TypeORM dùng chung cho ứng dụng (core.module.ts), script migrate
 * và test. Bảng chỉ tạo bằng migration, không dùng synchronize.
 */
export function dataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
    migrations: [`${__dirname}/migrations/*{.ts,.js}`],
    synchronize: false,
    // Khóa chính dùng gen_random_uuid() có sẵn từ PostgreSQL 13: không cần
    // tạo extension (DB quản lý thường không cho quyền CREATE EXTENSION).
    installExtensions: false,
  };
}
