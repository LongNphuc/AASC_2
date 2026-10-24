import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tạo 12 bảng, index, unique index một phần "một deal mở mỗi pipeline"
 * (readme_design.md mục 11). Mã kbn ghi thẳng số (16001 = deal OPEN).
 *
 * deals ↔ lead_submissions và webhook_events → lead_submissions trỏ vòng
 * nhau, nên khóa ngoại của chiều thứ hai được thêm sau khi đủ bảng.
 */
export class Init1793000000000 implements MigrationInterface {
  name = 'Init1793000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE webhook_events (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_kbn integer NOT NULL,
        event_id varchar(255) NOT NULL,
        event_name varchar(100),
        event_type_kbn integer,
        payload jsonb NOT NULL,
        headers jsonb,
        bitrix_deal_id integer,
        lead_submission_uuid uuid,
        status_kbn integer NOT NULL,
        error_kbn integer,
        error_detail jsonb,
        current_step_kbn integer,
        failed_at timestamptz,
        attempt_count integer NOT NULL DEFAULT 0,
        retry_count integer NOT NULL DEFAULT 0,
        received_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_webhook_events_provider_event UNIQUE (provider_kbn, event_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_webhook_events_status_received ON webhook_events (status_kbn, received_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE leads (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL,
        email varchar(255),
        phone varchar(50),
        city varchar(255),
        bitrix24_id integer UNIQUE,
        bitrix_contact_id integer UNIQUE,
        bitrix_sync_hash varchar(64),
        bitrix_synced_fields jsonb,
        bitrix_synced_at timestamptz,
        bitrix_contact_hash varchar(64),
        status_kbn integer NOT NULL,
        first_submitted_at timestamptz NOT NULL,
        last_submitted_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_leads_last_submitted ON leads (last_submitted_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE deals (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_uuid uuid NOT NULL REFERENCES leads(uuid),
        lead_submission_uuid uuid NOT NULL UNIQUE,
        bitrix24_id integer UNIQUE,
        title varchar(255) NOT NULL,
        pipeline_id varchar(50) NOT NULL,
        stage varchar(100) NOT NULL,
        status_kbn integer NOT NULL,
        origin_kbn integer NOT NULL,
        rule_snapshot jsonb,
        probability integer NOT NULL DEFAULT 0,
        amount numeric(15,2),
        currency varchar(3) NOT NULL DEFAULT 'VND',
        assigned_to integer,
        closed_at timestamptz,
        bitrix_synced_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    // Một khách chỉ có một deal đang mở trên mỗi pipeline: lớp chặn cuối trong
    // DB (readme_improvements.md mục 5).
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_deals_one_open_per_pipeline ON deals (lead_uuid, pipeline_id) WHERE status_kbn = 16001`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_deals_status_assigned ON deals (status_kbn, assigned_to)`,
    );

    await queryRunner.query(`
      CREATE TABLE lead_submissions (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_uuid uuid NOT NULL REFERENCES leads(uuid),
        webhook_event_uuid uuid NOT NULL UNIQUE REFERENCES webhook_events(uuid),
        deal_uuid uuid REFERENCES deals(uuid),
        channel_kbn integer NOT NULL,
        event_type_kbn integer NOT NULL,
        external_id varchar(255) NOT NULL,
        advertiser_id varchar(255),
        campaign_id varchar(255),
        campaign_name varchar(255),
        ad_id varchar(255),
        ad_name varchar(255),
        form_id varchar(255),
        form_name varchar(255),
        name varchar(255) NOT NULL,
        email varchar(255),
        phone varchar(50),
        city varchar(255),
        interests jsonb,
        answers jsonb NOT NULL DEFAULT '[]',
        utm_source varchar(255),
        utm_campaign varchar(255),
        ttclid varchar(255),
        quality_score integer NOT NULL,
        warnings jsonb NOT NULL DEFAULT '[]',
        sync_status_kbn integer NOT NULL,
        bitrix_action_kbn integer,
        error_kbn integer,
        error_detail jsonb,
        completed_at timestamptz,
        timeline_posted_at timestamptz,
        completion_posted_at timestamptz,
        deal_comment_posted_at timestamptz,
        submitted_at timestamptz NOT NULL,
        synced_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    for (const sql of [
      // Tìm khách trùng theo email hoặc SĐT trên mọi lượt gửi cũ (mục 4.4).
      `CREATE INDEX idx_submissions_email ON lead_submissions (email) WHERE email IS NOT NULL`,
      `CREATE INDEX idx_submissions_phone ON lead_submissions (phone) WHERE phone IS NOT NULL`,
      // Phân loại theo nguồn, thống kê theo khoảng thời gian gửi (mục 9).
      `CREATE INDEX idx_submissions_lead ON lead_submissions (lead_uuid)`,
      `CREATE INDEX idx_submissions_campaign_submitted ON lead_submissions (campaign_id, submitted_at)`,
      `CREATE INDEX idx_submissions_ad_submitted ON lead_submissions (ad_id, submitted_at)`,
      `CREATE INDEX idx_submissions_form_submitted ON lead_submissions (form_id, submitted_at)`,
      `CREATE INDEX idx_submissions_submitted ON lead_submissions (submitted_at)`,
      `CREATE INDEX idx_submissions_ttclid ON lead_submissions (ttclid) WHERE ttclid IS NOT NULL`,
      `CREATE INDEX idx_submissions_deal ON lead_submissions (deal_uuid) WHERE deal_uuid IS NOT NULL`,
      // Tìm lượt gửi cùng khách, cùng form cho form.complete.
      `CREATE INDEX idx_submissions_lead_form_submitted ON lead_submissions (lead_uuid, form_id, submitted_at)`,
      `ALTER TABLE deals ADD CONSTRAINT fk_deals_submission FOREIGN KEY (lead_submission_uuid) REFERENCES lead_submissions(uuid)`,
      `ALTER TABLE webhook_events ADD CONSTRAINT fk_webhook_events_submission FOREIGN KEY (lead_submission_uuid) REFERENCES lead_submissions(uuid)`,
    ]) {
      await queryRunner.query(sql);
    }

    await queryRunner.query(`
      CREATE TABLE engagement_events (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        webhook_event_uuid uuid NOT NULL UNIQUE REFERENCES webhook_events(uuid),
        advertiser_id varchar(255),
        campaign_id varchar(255),
        ad_id varchar(255),
        form_id varchar(255),
        interaction_type varchar(50) NOT NULL,
        ttclid varchar(255),
        occurred_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_engagement_ttclid ON engagement_events (ttclid) WHERE ttclid IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_engagement_campaign_occurred ON engagement_events (campaign_id, occurred_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE configurations (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(100) NOT NULL UNIQUE,
        value jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE campaign_spend (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id varchar(255) NOT NULL,
        campaign_name varchar(255),
        spend_date date NOT NULL,
        spend numeric(15,2) NOT NULL,
        currency varchar(3) NOT NULL DEFAULT 'VND',
        impressions integer,
        clicks integer,
        CONSTRAINT uq_campaign_spend_campaign_date UNIQUE (campaign_id, spend_date)
      )`);

    await queryRunner.query(`
      CREATE TABLE conversion_events (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_uuid uuid NOT NULL REFERENCES deals(uuid),
        lead_submission_uuid uuid REFERENCES lead_submissions(uuid),
        event_kbn integer NOT NULL,
        tiktok_event_name varchar(100) NOT NULL,
        event_id varchar(255) NOT NULL UNIQUE,
        status_kbn integer NOT NULL,
        tiktok_request_id varchar(255),
        error_kbn integer,
        error_detail jsonb,
        sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_conversion_events_deal_event UNIQUE (deal_uuid, event_kbn)
      )`);

    await queryRunner.query(`
      CREATE TABLE notifications (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type_kbn integer NOT NULL,
        channel varchar(20) NOT NULL DEFAULT 'bitrix',
        recipient_user_id integer NOT NULL,
        ref_type varchar(30) NOT NULL,
        ref_uuid uuid NOT NULL,
        message text NOT NULL,
        status_kbn integer NOT NULL,
        error_kbn integer,
        sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_notifications_ref_recipient UNIQUE (type_kbn, ref_type, ref_uuid, recipient_user_id)
      )`);

    await queryRunner.query(`
      CREATE TABLE alerts (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type_kbn integer NOT NULL,
        fingerprint varchar(255) NOT NULL,
        message text NOT NULL,
        details jsonb,
        notified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_alerts_fingerprint_created ON alerts (fingerprint, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_alerts_type_created ON alerts (type_kbn, created_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE reports (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type varchar(20) NOT NULL,
        period_start date NOT NULL,
        period_end date NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_reports_type_created ON reports (type, created_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE imports (
        uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        file_name varchar(255) NOT NULL,
        file_hash varchar(64) NOT NULL,
        total integer NOT NULL DEFAULT 0,
        enqueued integer NOT NULL DEFAULT 0,
        status_kbn integer NOT NULL,
        error_detail jsonb,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE webhook_events DROP CONSTRAINT fk_webhook_events_submission`,
    );
    await queryRunner.query(
      `ALTER TABLE deals DROP CONSTRAINT fk_deals_submission`,
    );
    for (const table of [
      'imports',
      'reports',
      'alerts',
      'notifications',
      'conversion_events',
      'campaign_spend',
      'configurations',
      'engagement_events',
      'lead_submissions',
      'deals',
      'leads',
      'webhook_events',
    ]) {
      await queryRunner.query(`DROP TABLE ${table}`);
    }
  }
}
