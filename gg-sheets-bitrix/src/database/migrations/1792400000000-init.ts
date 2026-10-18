import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tạo 4 bảng: mappings, sync_runs, sync_batches, google_auth. */
export class Init1792400000000 implements MigrationInterface {
  name = 'Init1792400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE mappings (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        version integer NOT NULL UNIQUE,
        mapping_json jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE TABLE sync_runs (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_kbn integer NOT NULL,
        trigger_kbn integer NOT NULL,
        status_kbn integer NOT NULL,
        error_kbn integer,
        error_detail text,
        mapping_uuid uuid REFERENCES mappings(uuid),
        summary jsonb,
        problem_rows jsonb,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_sync_runs_batch_started ON sync_runs (batch_kbn, started_at DESC)`,
    );
    await queryRunner.query(`
      CREATE TABLE sync_batches (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_kbn integer NOT NULL UNIQUE,
        name varchar(100) NOT NULL,
        interval_seconds integer NOT NULL,
        batch_status_kbn integer NOT NULL DEFAULT 11000,
        run_uuid uuid REFERENCES sync_runs(uuid) ON DELETE SET NULL,
        started_at timestamptz,
        finished_at timestamptz,
        heartbeat_at timestamptz,
        cooldown_until timestamptz
      )`);
    // Access token Google, mỗi chế độ xác thực một dòng; batch "Làm mới token
    // Google" ghi, các lệnh gọi Sheets API chỉ đọc. refresh_token chỉ có ở OAuth.
    await queryRunner.query(`
      CREATE TABLE google_auth (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        auth_mode varchar(20) NOT NULL UNIQUE,
        account_email varchar(255),
        refresh_token text,
        access_token text,
        expires_at timestamptz,
        refreshed_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE google_auth');
    await queryRunner.query('DROP TABLE sync_batches');
    await queryRunner.query('DROP TABLE sync_runs');
    await queryRunner.query('DROP TABLE mappings');
  }
}
