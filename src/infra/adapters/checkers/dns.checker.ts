import dns from "node:dns/promises";
import type { IUptimeChecker } from "../../../domain/interfaces/uptime-checker.interface";
import type { CheckResult } from "../../../domain/value-objects/check-result";
import type { MonitorConfig } from "../../../domain/value-objects/monitor-config";
import { UptimeStatus } from "../../../domain/value-objects/uptime-status";

export class DnsChecker implements IUptimeChecker {
    async check(config: MonitorConfig): Promise<CheckResult> {
        const startTime = Date.now();
        const timeoutMs = config.timeoutSeconds * 1000;

        const url = new URL(config.url);
        const hostname = url.hostname;

        const abortController = new AbortController();
        const timer = setTimeout(() => abortController.abort(), timeoutMs);

        try {
            const addresses = await dns.resolve4(hostname);
            clearTimeout(timer);

            const responseTimeMs = Date.now() - startTime;
            const ipAddress = addresses.length > 0 ? addresses[0] : null;

            return {
                status: UptimeStatus.UP,
                responseTimeMs,
                statusCode: null,
                errorMessage: null,
                ipAddress,
                tlsCertificateDaysRemaining: null,
                sslExpiryWarning: false,
            };
        } catch (err) {
            clearTimeout(timer);
            const responseTimeMs = Date.now() - startTime;

            const isTimeout = abortController.signal.aborted;
            const errorMessage = isTimeout
                ? `Timeout after ${timeoutMs}ms`
                : err instanceof Error
                  ? err.message
                  : "DNS resolution failed";

            return {
                status: UptimeStatus.DOWN,
                responseTimeMs,
                statusCode: null,
                errorMessage,
                ipAddress: null,
                tlsCertificateDaysRemaining: null,
                sslExpiryWarning: false,
            };
        }
    }
}
