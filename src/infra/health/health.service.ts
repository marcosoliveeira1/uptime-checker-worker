import type { RabbitMQAdapter } from "../adapters/rabbitmq.adapter";

export interface HealthStatus {
    status: "healthy" | "degraded" | "unhealthy";
    uptime_seconds: number;
    monitors_active: number;
    checks_total: number;
    checks_failed: number;
    active_checks: number;
    scheduler_running: boolean;
    rabbitmq_connected: boolean;
}

export interface HealthMetricsProvider {
    getMonitorsActive(): number;
    getChecksTotal(): number;
    getChecksFailed(): number;
    getActiveChecks(): number;
    isSchedulerRunning(): boolean;
}

export class HealthService {
    private startTime = Date.now();
    private metricsProvider: HealthMetricsProvider | null = null;

    constructor(private readonly broker: RabbitMQAdapter) {}

    setMetricsProvider(provider: HealthMetricsProvider): void {
        this.metricsProvider = provider;
    }

    async check(): Promise<HealthStatus> {
        const rabbitmqConnected = this.broker.isConnected();
        const schedulerRunning =
            this.metricsProvider?.isSchedulerRunning() ?? false;

        const isHealthy = rabbitmqConnected;
        const status = isHealthy ? "healthy" : "degraded";

        return {
            status,
            uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
            monitors_active: this.metricsProvider?.getMonitorsActive() ?? 0,
            checks_total: this.metricsProvider?.getChecksTotal() ?? 0,
            checks_failed: this.metricsProvider?.getChecksFailed() ?? 0,
            active_checks: this.metricsProvider?.getActiveChecks() ?? 0,
            scheduler_running: schedulerRunning,
            rabbitmq_connected: rabbitmqConnected,
        };
    }

    async isReady(): Promise<boolean> {
        const rabbitmqConnected = this.broker.isConnected();
        const schedulerRunning =
            this.metricsProvider?.isSchedulerRunning() ?? false;
        return rabbitmqConnected && schedulerRunning;
    }
}
