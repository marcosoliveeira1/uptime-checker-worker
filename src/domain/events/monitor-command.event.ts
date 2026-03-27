import { Protocol } from '../value-objects/protocol';

export interface AddSiteCommand {
  monitor_id: number;
  site_id: number;
  workspace_id: number;
  url: string;
  protocol: Protocol;
  check_interval_seconds: number;
  timeout_seconds: number;
  expected_status_code?: number;
  keyword_check?: string;
  idempotency_key: string;
}

export interface UpdateSiteCommand {
  monitor_id: number;
  site_id: number;
  workspace_id: number;
  url: string;
  protocol: Protocol;
  check_interval_seconds: number;
  timeout_seconds: number;
  expected_status_code?: number;
  keyword_check?: string;
  idempotency_key: string;
}

export interface RemoveSiteCommand {
  monitor_id: number;
  idempotency_key: string;
}
