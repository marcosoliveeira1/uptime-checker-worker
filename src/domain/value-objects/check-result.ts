import { UptimeStatus } from "./uptime-status";

export interface CheckResult {
    status: UptimeStatus;
    responseTimeMs: number | null;
    statusCode: number | null;
    errorMessage: string | null;
    ipAddress: string | null;
    tlsCertificateDaysRemaining: number | null;
    sslExpiryWarning?: boolean;
}
