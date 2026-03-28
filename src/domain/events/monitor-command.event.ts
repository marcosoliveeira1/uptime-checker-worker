import { Protocol } from "../value-objects/protocol";

export interface AddSiteCommand {
    monitor_id: string;
    site_id: string;
    workspace_id: string;
    url: string;
    protocol: Protocol;
    check_interval_seconds: number;
    timeout_seconds: number;
    expected_status_code?: number;
    accepted_status_codes?: number[];
    follow_redirects?: boolean;
    slow_threshold_ms?: number;
    check_ssl?: boolean;
    ssl_expiry_reminder_days?: number;
    keyword_check?: string;
    idempotency_key: string;
}

export interface UpdateSiteCommand {
    monitor_id: string;
    site_id: string;
    workspace_id: string;
    url: string;
    protocol: Protocol;
    check_interval_seconds: number;
    timeout_seconds: number;
    expected_status_code?: number;
    accepted_status_codes?: number[];
    follow_redirects?: boolean;
    slow_threshold_ms?: number;
    check_ssl?: boolean;
    ssl_expiry_reminder_days?: number;
    keyword_check?: string;
    idempotency_key: string;
}

export interface RemoveSiteCommand {
    monitor_id: string;
    idempotency_key: string;
}
