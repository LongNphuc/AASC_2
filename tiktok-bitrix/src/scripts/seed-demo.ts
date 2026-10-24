import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { addDays, localDate } from '../common/query/date-range';
import { loadEnvFileIfPresent } from '../config/load-env-file';
import { dataSourceOptions } from '../database/data-source';

interface SpendTemplate {
  campaign_id: string;
  campaign_name: string;
  daily_spend: number;
  daily_impressions: number;
  daily_clicks: number;
}

/**
 * npm run seed:demo: chi phí quảng cáo 30 ngày gần nhất của các campaign mẫu
 * (seeds/campaign-spend.json), để có CPL và ROI (readme_design.md mục 9.4).
 * Chạy lại thì ghi đè cùng ngày (UNIQUE campaign_id, spend_date).
 */
async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const templates = JSON.parse(
    readFileSync('seeds/campaign-spend.json', 'utf8'),
  ) as SpendTemplate[];
  const dataSource = await new DataSource(
    dataSourceOptions(process.env.DATABASE_URL ?? ''),
  ).initialize();
  const today = localDate(
    new Date(),
    process.env.APP_TIMEZONE ?? 'Asia/Ho_Chi_Minh',
  );
  let rows = 0;
  try {
    for (const t of templates) {
      for (let day = 0; day < 30; day++) {
        // Dao động ±20% theo ngày, cố định theo ngày để chạy lại ra cùng số.
        const factor =
          0.8 + ((day * 37 + t.campaign_id.length * 11) % 40) / 100;
        await dataSource.query(
          `INSERT INTO campaign_spend (campaign_id, campaign_name, spend_date, spend, currency, impressions, clicks)
           VALUES ($1, $2, $3, $4, 'VND', $5, $6)
           ON CONFLICT (campaign_id, spend_date) DO UPDATE
             SET campaign_name = EXCLUDED.campaign_name, spend = EXCLUDED.spend,
                 impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks`,
          [
            t.campaign_id,
            t.campaign_name,
            addDays(today, -day),
            Math.round(t.daily_spend * factor),
            Math.round(t.daily_impressions * factor),
            Math.round(t.daily_clicks * factor),
          ],
        );
        rows++;
      }
    }
    console.log(
      `[seed:demo] Đã nạp ${rows} dòng chi phí cho ${templates.length} campaign (30 ngày tới ${today})`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('[seed:demo]', error instanceof Error ? error.message : error);
  process.exit(1);
});
