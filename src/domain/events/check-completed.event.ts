import { UptimeStatus } from '../value-objects/uptime-status';

export interface CheckCompletedEvent {
  monitor_id: string;
  site_id: string;
  workspace_id: string;
  status: UptimeStatus;
  response_time_ms: number | null;
  status_code: number | null;
  error_message: string | null;
  ip_address: string | null;
  tls_certificate_days_remaining: number | null;
  ssl_expiry_warning: boolean;
  checked_at: string;
  idempotency_key: string;
}

export interface WorkerStartedEvent {
  started_at: string;
  instance_id: string;
}
