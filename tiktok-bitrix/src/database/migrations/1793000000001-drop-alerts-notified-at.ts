import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cảnh báo chỉ ghi log, không gửi thông báo lên Bitrix24 nữa
 * (readme_design.md mục 9.8): bỏ cột alerts.notified_at.
 */
export class DropAlertsNotifiedAt1793000000001 implements MigrationInterface {
  name = 'DropAlertsNotifiedAt1793000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE alerts DROP COLUMN notified_at`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE alerts ADD COLUMN notified_at timestamptz`,
    );
  }
}
