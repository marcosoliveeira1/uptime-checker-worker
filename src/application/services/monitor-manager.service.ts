import type { CheckCompletedEvent } from "../../domain/events/check-completed.event";
import type {
    AddSiteCommand,
    RemoveSiteCommand,
    UpdateSiteCommand,
} from "../../domain/events/monitor-command.event";
import type { IMessageBroker } from "../../domain/interfaces/message-broker.interface";
import type { IMonitorScheduler } from "../../domain/interfaces/monitor-scheduler.interface";
import type { CheckResult } from "../../domain/value-objects/check-result";
import type { MonitorConfig } from "../../domain/value-objects/monitor-config";
import type { CheckerFactory } from "../../infra/adapters/checkers/checker.factory";
import { createServiceLogger } from "../../infra/config/logger";
import type { HealthMetricsProvider } from "../../infra/health/health.service";
import type { WideEventEmitter } from "../../infra/observability/wide-event.emitter";

const log = createServiceLogger("monitor-manager");

interface MonitorEntry {
    config: MonitorConfig;
    lastCheckAt?: number;
}

export class MonitorManager implements HealthMetricsProvider {
    private readonly registry = new Map<string, MonitorEntry>();
    private checksTotal = 0;
    private checksFailed = 0;

    constructor(
        private readonly scheduler: IMonitorScheduler,
        private readonly checkerFactory: CheckerFactory,
        private readonly broker: IMessageBroker,
        private readonly wideEventEmitter: WideEventEmitter,
    ) {}

    addMonitor(command: AddSiteCommand): void {
        const monitorId = command.monitor_id;

        // Idempotency: if already exists, treat as update
        if (this.registry.has(monitorId)) {
            log.info(
                { monitorId },
                "Monitor already exists, treating add as update",
            );
            this.updateMonitor(command as unknown as UpdateSiteCommand);
            return;
        }

        const config = this.commandToConfig(command);
        const intervalMs = config.checkIntervalSeconds * 1000;

        this.registry.set(monitorId, { config });
        this.scheduler.add(monitorId, intervalMs, () =>
            this.executeCheck(monitorId),
        );

        log.info(
            {
                monitorId,
                url: config.url,
                protocol: config.protocol,
                intervalSeconds: config.checkIntervalSeconds,
            },
            "Monitor added",
        );
    }

    updateMonitor(command: UpdateSiteCommand): void {
        const monitorId = command.monitor_id;
        const config = this.commandToConfig(command);
        const intervalMs = config.checkIntervalSeconds * 1000;

        const existing = this.registry.get(monitorId);
        this.registry.set(monitorId, {
            config,
            lastCheckAt: existing?.lastCheckAt,
        });

        if (existing) {
            this.scheduler.update(monitorId, intervalMs);
        } else {
            this.scheduler.add(monitorId, intervalMs, () =>
                this.executeCheck(monitorId),
            );
        }

        log.info(
            { monitorId, url: config.url, protocol: config.protocol },
            "Monitor updated",
        );
    }

    removeMonitor(command: RemoveSiteCommand): void {
        const monitorId = command.monitor_id;

        this.registry.delete(monitorId);
        this.scheduler.remove(monitorId);

        log.info({ monitorId }, "Monitor removed");
    }

    async executeCheck(monitorId: string): Promise<void> {
        const entry = this.registry.get(monitorId);
        if (!entry) {
            log.warn({ monitorId }, "Check triggered for unknown monitor");
            return;
        }

        const { config } = entry;
        const startTime = Date.now();

        let result: CheckResult;
        try {
            const checker = this.checkerFactory.getChecker(config.protocol);
            result = await checker.check(config);
        } catch (err) {
            result = {
                status: "down",
                responseTimeMs: Date.now() - startTime,
                statusCode: null,
                errorMessage:
                    err instanceof Error ? err.message : "Unknown error",
                ipAddress: null,
                tlsCertificateDaysRemaining: null,
                sslExpiryWarning: false,
            };
        }

        const duration = Date.now() - startTime;

        // Update metrics
        this.checksTotal++;
        if (result.status === "down") {
            this.checksFailed++;
        }

        // Update registry
        entry.lastCheckAt = Date.now();

        // Build and publish event
        const event: CheckCompletedEvent = {
            monitor_id: config.monitorId,
            site_id: config.siteId,
            workspace_id: config.workspaceId,
            status: result.status,
            response_time_ms: result.responseTimeMs,
            status_code: result.statusCode,
            error_message: result.errorMessage,
            ip_address: result.ipAddress,
            tls_certificate_days_remaining: result.tlsCertificateDaysRemaining,
            ssl_expiry_warning: result.sslExpiryWarning ?? false,
            checked_at: new Date().toISOString(),
            idempotency_key: `${monitorId}:${Math.floor(Date.now() / 60000)}`,
        };

        await this.broker.publish("uptime.results", "check.completed", event);

        // Emit wide event
        this.wideEventEmitter.emit(config, result, duration);
    }

    // HealthMetricsProvider implementation
    getMonitorsActive(): number {
        return this.registry.size;
    }

    getChecksTotal(): number {
        return this.checksTotal;
    }

    getChecksFailed(): number {
        return this.checksFailed;
    }

    getActiveChecks(): number {
        return this.scheduler.getActiveChecks();
    }

    isSchedulerRunning(): boolean {
        return this.scheduler.getActiveCount() >= 0; // scheduler is always "running" if it exists
    }

    private commandToConfig(
        command: AddSiteCommand | UpdateSiteCommand,
    ): MonitorConfig {
        return {
            monitorId: command.monitor_id,
            siteId: command.site_id,
            workspaceId: command.workspace_id,
            url: command.url,
            protocol: command.protocol,
            checkIntervalSeconds: command.check_interval_seconds,
            timeoutSeconds: command.timeout_seconds,
            expectedStatusCode: command.expected_status_code,
            acceptedStatusCodes: command.accepted_status_codes,
            followRedirects: command.follow_redirects,
            slowThresholdMs: command.slow_threshold_ms,
            checkSsl: command.check_ssl,
            sslExpiryReminderDays: command.ssl_expiry_reminder_days,
            keywordCheck: command.keyword_check,
        };
    }
}
