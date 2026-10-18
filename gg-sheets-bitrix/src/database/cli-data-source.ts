import { DataSource } from 'typeorm';
import { loadEnvFileIfPresent } from '../config/load-env-file';
import { dataSourceOptions } from './data-source';

/** DataSource cho `npm run migration:run` / `migration:revert` (đọc DATABASE_URL trong .env). */
loadEnvFileIfPresent();
export default new DataSource(
  dataSourceOptions(
    process.env.DATABASE_URL ||
      'postgres://sync:sync@localhost:5432/gg_sheets_bitrix',
  ),
);
