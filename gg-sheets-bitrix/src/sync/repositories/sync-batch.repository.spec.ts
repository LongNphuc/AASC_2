import { DataSource } from 'typeorm';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { BatchStatusKbn, TriggerKbn } from '../../common/kbn/sync.kbn';
import { dataSourceOptions } from '../../database/data-source';
import { SyncBatch } from '../entities/sync-batch.entity';
import { SyncBatchRepository } from './sync-batch.repository';

/**
 * Chạy với PostgreSQL thật (câu giành khóa dùng RETURNING old.*, cần bản 18):
 *   docker compose up -d db
 *   docker compose exec db createdb -U sync gg_sheets_bitrix_test
 *   TEST_DATABASE_URL=postgres://sync:sync@localhost:5432/gg_sheets_bitrix_test npm test
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('SyncBatchRepository (PostgreSQL thật)', () => {
  const BATCH = 14001;
  let dataSource: DataSource;
  let repo: SyncBatchRepository;
  const base = {
    batchKbn: BATCH,
    triggerKbn: TriggerKbn.MANUAL,
    mappingUuid: '',
    manual: true,
    staleSeconds: 120,
  };
  const runCount = async () =>
    Number(
      (await dataSource.query('SELECT count(*) AS n FROM sync_runs'))[0].n,
    );
  const batchRow = async () =>
    (
      await dataSource.query(
        'SELECT * FROM sync_batches WHERE batch_kbn = $1',
        [BATCH],
      )
    )[0];

  beforeAll(async () => {
    dataSource = new DataSource({
      ...dataSourceOptions(url!),
      entities: [SyncBatch],
      migrationsRun: false,
    });
    await dataSource.initialize();
    await dataSource.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await dataSource.runMigrations();
    repo = new SyncBatchRepository(
      dataSource,
      dataSource.getRepository(SyncBatch),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'DELETE FROM sync_batches; DELETE FROM sync_runs; DELETE FROM mappings;',
    );
    const [{ uuid }] = await dataSource.query(
      `INSERT INTO mappings (version, mapping_json) VALUES (1, '{}') RETURNING uuid`,
    );
    base.mappingUuid = uuid;
    await repo.ensure(BATCH, 'Sheet → Bitrix24', 900);
  });

  it('ensure: dòng mới có finished_at = lúc tạo (lần chạy đầu chờ một chu kỳ); gọi lại thì cập nhật chu kỳ', async () => {
    const row = await batchRow();
    expect(row.batch_status_kbn).toBe(BatchStatusKbn.DONE);
    expect(row.finished_at).not.toBeNull();
    await repo.ensure(BATCH, 'Sheet → Bitrix24', 3600);
    expect((await batchRow()).interval_seconds).toBe(3600);
  });

  it('hai lần giành cùng lúc: đúng một lần thành công, bên thua nhận kết quả ngay và không để lại dòng sync_runs', async () => {
    const results = await Promise.all([repo.acquire(base), repo.acquire(base)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await runCount()).toBe(1);
    const row = await batchRow();
    expect(row.batch_status_kbn).toBe(BatchStatusKbn.RUNNING);
    expect(row.run_uuid).toBe(results.find(Boolean)!.runUuid);
  });

  it('theo lịch: chưa qua (lần trước xong + chu kỳ) thì không giành; đã qua thì giành được', async () => {
    await dataSource.query(
      `UPDATE sync_batches SET interval_seconds = 900, finished_at = now() - interval '14 minutes' WHERE batch_kbn = $1`,
      [BATCH],
    );
    expect(
      await repo.acquire({
        ...base,
        manual: false,
        triggerKbn: TriggerKbn.SCHEDULE,
      }),
    ).toBeNull();
    await dataSource.query(
      `UPDATE sync_batches SET finished_at = now() - interval '16 minutes' WHERE batch_kbn = $1`,
      [BATCH],
    );
    expect(
      await repo.acquire({
        ...base,
        manual: false,
        triggerKbn: TriggerKbn.SCHEDULE,
      }),
    ).not.toBeNull();
  });

  it('cooldown chặn cả chạy tay', async () => {
    await dataSource.query(
      `UPDATE sync_batches SET cooldown_until = now() + interval '5 minutes' WHERE batch_kbn = $1`,
      [BATCH],
    );
    expect(await repo.acquire(base)).toBeNull();
  });

  it('lần chạy đã chết (nhịp tim cũ): giành lại khóa, ghi lần cũ FAILED 60005; release của lần cũ không đặt DONE lên khóa mới', async () => {
    const first = await repo.acquire(base);
    expect(await repo.acquire(base)).toBeNull();
    await dataSource.query(
      `UPDATE sync_batches SET heartbeat_at = now() - interval '10 minutes' WHERE batch_kbn = $1`,
      [BATCH],
    );

    const second = await repo.acquire(base);

    expect(second!.recoveredRunUuid).toBe(first!.runUuid);
    const [old] = await dataSource.query(
      'SELECT status_kbn, error_kbn FROM sync_runs WHERE uuid = $1',
      [first!.runUuid],
    );
    expect(old).toEqual({
      status_kbn: StatusKbn.FAILED,
      error_kbn: ErrorKbn.STALE_RECOVERED,
    });
    expect(await repo.heartbeat(BATCH, first!.runUuid)).toBe(false);
    await repo.release(BATCH, first!.runUuid);
    expect((await batchRow()).batch_status_kbn).toBe(BatchStatusKbn.RUNNING);

    expect(await repo.heartbeat(BATCH, second!.runUuid)).toBe(true);
    await repo.setCooldown(
      BATCH,
      second!.runUuid,
      new Date(Date.now() + 60_000),
    );
    await repo.release(BATCH, second!.runUuid);
    const row = await batchRow();
    expect(row.batch_status_kbn).toBe(BatchStatusKbn.DONE);
    expect(row.cooldown_until).not.toBeNull();
    expect((await repo.find(BATCH))!.name).toBe('Sheet → Bitrix24');
    expect(await repo.findAll()).toHaveLength(1);
  });
});
