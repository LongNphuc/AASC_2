import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * E2E với PostgreSQL thật (xem readme_run.md bước 7):
 *   TEST_DATABASE_URL=postgres://sync:sync@localhost:5432/gg_sheets_bitrix_test npm run test:e2e
 * Không cấu hình Google/Bitrix24 (tệp khóa trỏ tới chỗ không có, nên không gọi
 * Google thật): lần chạy sẽ FAILED vì thiếu cấu hình, đủ để kiểm tra luồng
 * HTTP, khóa, mapping và batch làm mới token.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;
const KEY = 'e2e-key';

describeDb('Ứng dụng (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      API_KEY: KEY,
      MAPPING_FILE: join(__dirname, '..', 'mapping.json'),
      LOG_DIR: mkdtempSync(join(tmpdir(), 'e2e-logs-')),
      GOOGLE_AUTH_MODE: 'service_account',
      GOOGLE_SERVICE_ACCOUNT_FILE: join(tmpdir(), 'e2e-khong-co-tep.json'),
      GOOGLE_SPREADSHEET_ID: '',
      GOOGLE_SHEET_NAME: '',
      BITRIX24_WEBHOOK_URL: '',
      BITRIX24_OUTBOUND_TOKEN: 'e2e-token',
      SYNC_DIRECTION: 'both',
    });
    const reset = new DataSource({ type: 'postgres', url });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  const auth = (req: request.Test) => req.set('x-api-key', KEY);

  it('/health không cần API key; DB đang chạy', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('thiếu hoặc sai API key → 401 (20002)', async () => {
    const res = await request(app.getHttpServer())
      .get('/sync/batches')
      .expect(401);
    expect(res.body.errorKbn).toBe(20002);
    await request(app.getHttpServer())
      .get('/sync/batches')
      .set('x-api-key', 'sai')
      .expect(401);
  });

  it('GET /sync/batches: batch Sheet → Bitrix24 (900 giây, lần chạy đầu sau một chu kỳ) và batch làm mới token (1800 giây)', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/sync/batches'),
    ).expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        batch: 'SHEET_TO_BITRIX',
        intervalSeconds: 900,
        status: 'DONE',
      }),
      expect.objectContaining({
        batch: 'GOOGLE_TOKEN_REFRESH',
        intervalSeconds: 1800,
      }),
    ]);
    const next = new Date(res.body[0].nextRunAt).getTime();
    expect(next).toBeGreaterThan(Date.now() + 800_000);
    expect(next).toBeLessThanOrEqual(Date.now() + 900_000);
  });

  it('khởi động chưa có token Google → batch token chạy ngay (STARTUP); không đọc được tệp khóa → FAILED 50012', async () => {
    let runs: { trigger: string; status: string; errorKbn: number }[] = [];
    for (let i = 0; i < 50 && runs[0]?.status !== 'FAILED'; i++) {
      runs = (
        await auth(
          request(app.getHttpServer()).get(
            '/sync/runs?batch=GOOGLE_TOKEN_REFRESH',
          ),
        )
      ).body;
      if (runs[0]?.status !== 'FAILED')
        await new Promise((r) => setTimeout(r, 100));
    }
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: 'STARTUP',
      status: 'FAILED',
      errorKbn: 50012,
    });
  });

  it('GET /mapping: mapping.json đã nạp thành phiên bản 1; kiểm tra báo thiếu cấu hình Google', async () => {
    const res = await auth(request(app.getHttpServer()).get('/mapping')).expect(
      200,
    );
    expect(res.body).toMatchObject({ version: 1, valid: false });
    expect(res.body.errors[0]).toMatchObject({ errorKbn: 30012 });
    const versions = await auth(
      request(app.getHttpServer()).get('/mapping/versions'),
    ).expect(200);
    expect(versions.body).toHaveLength(1);
    await auth(request(app.getHttpServer()).get('/mapping/versions/1')).expect(
      200,
    );
    await auth(request(app.getHttpServer()).get('/mapping/versions/9')).expect(
      404,
    );
    const rules = await auth(
      request(app.getHttpServer()).get('/mapping/rules'),
    ).expect(200);
    expect(rules.body).toHaveLength(5);
  });

  it('PUT /mapping sai cấu trúc → 400 (20004) kèm danh sách lỗi; body thiếu trường → 400', async () => {
    const res = await auth(request(app.getHttpServer()).put('/mapping'))
      .send({
        baseVersion: 1,
        mappingJson: { columns: [], duplicate_keys: ['EMAIL'] },
      })
      .expect(400);
    expect(res.body).toMatchObject({
      errorKbn: 20004,
      error: 'MAPPING_INVALID',
    });
    expect(res.body.details.errors[0]).toMatchObject({ path: 'columns' });
    await auth(request(app.getHttpServer()).put('/mapping'))
      .send({ mappingJson: {} })
      .expect(400);
  });

  it('POST /sync/run → 202; lần chạy FAILED vì thiếu GOOGLE_SPREADSHEET_ID, khóa được trả', async () => {
    const res = await auth(
      request(app.getHttpServer()).post('/sync/run'),
    ).expect(202);
    expect(res.body).toMatchObject({ status: 'PROCESSING', statusKbn: 10002 });
    let run: { status: string; errorKbn: number } | undefined;
    for (let i = 0; i < 50 && run?.status !== 'FAILED'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      run = (
        await auth(
          request(app.getHttpServer()).get(`/sync/runs/${res.body.runUuid}`),
        )
      ).body;
    }
    expect(run).toMatchObject({ status: 'FAILED', errorKbn: 30012 });
    const list = await auth(
      request(app.getHttpServer()).get('/sync/runs?limit=5'),
    ).expect(200);
    expect(list.body[0]).toMatchObject({
      uuid: res.body.runUuid,
      trigger: 'MANUAL',
      mappingVersion: 1,
    });
    const batches = await auth(
      request(app.getHttpServer()).get('/sync/batches'),
    );
    expect(batches.body[0].status).toBe('DONE');
  });

  it('đang có lần chạy khác → 409 (60001) trả về ngay; đang cooldown → 429 kèm Retry-After', async () => {
    const [{ uuid }] = await db.query(
      `INSERT INTO sync_runs (batch_kbn, trigger_kbn, status_kbn) VALUES (14001, 13002, 10002) RETURNING uuid`,
    );
    await db.query(
      `UPDATE sync_batches SET batch_status_kbn = 11001, run_uuid = $1, heartbeat_at = now() WHERE batch_kbn = 14001`,
      [uuid],
    );
    const busy = await auth(
      request(app.getHttpServer()).post('/sync/run'),
    ).expect(409);
    expect(busy.body).toMatchObject({
      errorKbn: 60001,
      details: { runUuid: uuid },
    });

    await db.query(
      `UPDATE sync_batches SET batch_status_kbn = 11000, cooldown_until = now() + interval '90 seconds' WHERE batch_kbn = 14001`,
    );
    const cooldown = await auth(
      request(app.getHttpServer()).post('/sync/run'),
    ).expect(429);
    expect(cooldown.body.errorKbn).toBe(60002);
    expect(Number(cooldown.headers['retry-after'])).toBeGreaterThan(80);
    await db.query(
      `UPDATE sync_batches SET cooldown_until = NULL WHERE batch_kbn = 14001`,
    );
  });

  it('GET /sync/runs/:uuid không đúng định dạng → 400; không có → 404', async () => {
    await auth(request(app.getHttpServer()).get('/sync/runs/abc')).expect(400);
    await auth(
      request(app.getHttpServer()).get(
        '/sync/runs/00000000-0000-4000-8000-000000000000',
      ),
    ).expect(404);
  });

  it('POST /webhooks/bitrix24 (form-urlencoded như Bitrix24 gửi) không cần API key; sai application_token → 401; sự kiện khác → 200 bỏ qua', async () => {
    const send = (body: string) =>
      request(app.getHttpServer())
        .post('/webhooks/bitrix24')
        .type('form')
        .send(body);
    const rejected = await send(
      'event=ONCRMLEADUPDATE&data[FIELDS][ID]=5&auth[application_token]=sai',
    ).expect(401);
    expect(rejected.body.errorKbn).toBe(20002);
    const ignored = await send(
      'event=ONCRMDEALUPDATE&data[FIELDS][ID]=5&auth[application_token]=e2e-token',
    ).expect(200);
    expect(ignored.body).toEqual({ accepted: false, reason: 'EVENT_IGNORED' });
  });
});
