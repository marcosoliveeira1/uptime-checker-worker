import { logger } from "../config/logger";
import { UptimeWideEvent } from "../../domain/events/wide-event";
import { MonitorConfig } from "../../domain/value-objects/monitor-config";
import { CheckResult } from "../../domain/value-objects/check-result";

export class WideEventEmitter {
    emit(config: MonitorConfig, result: CheckResult, duration: number): void {
        const event: UptimeWideEvent = {
            service: "uptime-checker-worker",
            operation: "check.execute",
            timestamp: new Date().toISOString(),
            duration,

            monitorId: config.monitorId,
            siteId: config.siteId,
            workspaceId: config.workspaceId,
            protocol: config.protocol,
            url: config.url,

            status: result.status,
            responseTimeMs: result.responseTimeMs,
            statusCode: result.statusCode,
            tlsCertDaysRemaining: result.tlsCertificateDaysRemaining,

            outcome: result.errorMessage ? "error" : "ok",
            ...(result.errorMessage && {
                error: { message: result.errorMessage },
            }),

            environment: {
                nodeEnv: process.env.NODE_ENV,
            },
        };

        const logLevel = event.outcome === "error" ? "error" : "info";
        logger[logLevel](
            { wideEvent: event },
            `Check ${config.monitorId} [${config.protocol}] - ${result.status.toUpperCase()}`,
        );
    }
}
