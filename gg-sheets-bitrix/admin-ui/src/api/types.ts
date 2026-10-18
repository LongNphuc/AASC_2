/** Kiểu dữ liệu các API của backend (xem readme_api.md). */
export interface Batch {
  batch: string;
  name: string;
  intervalSeconds: number;
  status: 'DONE' | 'RUNNING';
  runUuid: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  stale: boolean;
  cooldownUntil: string | null;
  nextRunAt: string | null;
}

export type RunStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'PROCESSING';

export interface RunSummary {
  total_rows: number;
  skipped_rows: number;
  invalid_rows: number;
  upload_succeeded: { created: number; updated: number };
  upload_failed: number;
  pending_rows: number;
}

export interface ProblemGroup {
  status_kbn: number;
  error_kbn: number;
  message: string;
  retry_after?: string;
  rows: { row: number; name: string; lead_id?: number }[];
}

/** summary của batch làm mới token Google. */
export interface TokenRunSummary {
  account_email: string | null;
  expires_at: string;
}

export function isRowSummary(summary: RunSummary | TokenRunSummary | null | undefined): summary is RunSummary {
  return !!summary && 'total_rows' in summary;
}

export type Trigger = 'SCHEDULE' | 'MANUAL' | 'STARTUP';

export interface Run {
  uuid: string;
  batch: string;
  trigger: Trigger;
  status: RunStatus;
  statusKbn: number;
  errorKbn: number | null;
  errorDetail: string | null;
  mappingVersion: number | null;
  startedAt: string;
  finishedAt: string | null;
  summary: RunSummary | TokenRunSummary | null;
  problem_rows?: ProblemGroup[];
}

export interface RunAccepted {
  runUuid: string;
  status: string;
  startedAt: string;
}

export interface MappingIssue {
  path: string;
  errorKbn: number;
  message: string;
}

export interface MappingCurrent {
  version: number | null;
  mappingJson: unknown;
  createdAt: string | null;
  valid: boolean;
  errors: MappingIssue[];
}

export interface MappingVersion {
  version: number;
  createdAt: string;
  mappingJson?: unknown;
}

export interface Rule {
  name: string;
  description: string;
}

export interface LeadField {
  code: string;
  title: string;
  type: string;
  isMultiple: boolean;
  isReadOnly: boolean;
}

/** Body lỗi thống nhất của backend. */
export interface ErrorBody {
  statusCode?: number;
  error?: string;
  errorKbn?: number;
  message?: string | string[];
  details?: { errors?: MappingIssue[]; [key: string]: unknown };
}
