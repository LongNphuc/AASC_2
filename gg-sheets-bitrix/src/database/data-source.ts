import type { DataSourceOptions } from 'typeorm';

/**
 * Cấu hình TypeORM dùng chung cho ứng dụng (app.module.ts) và lệnh migration
 * (cli-data-source.ts). Bảng chỉ tạo bằng migration, không dùng synchronize.
 */
export function dataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
    migrations: [`${__dirname}/migrations/*{.ts,.js}`],
    synchronize: false,
  };
}
