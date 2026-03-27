import { UptimeStatus } from '../value-objects/uptime-status';

export interface CheckCompletedEvent {
  monitor_id: number;
  site_id: number;
  workspace_id: number;
  status: UptimeStatus;
  response_time_ms: number | null;
  status_code: number | null;
  error_message: string | null;
  ip_address: string | null;
  tls_certificate_days_remaining: number | null;
  checked_at: string;
  idempotency_key: string;
}

export interface WorkerStartedEvent {
  started_at: string;
  instance_id: string;
}
