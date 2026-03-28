import { IMonitorScheduler } from "../../domain/interfaces/monitor-scheduler.interface";
import { createSchedulerLogger } from "../config/logger";

const log = createSchedulerLogger();

interface SchedulerEntry {
    intervalMs: number;
    nextCheckAt: number;
    callback: () => Promise<void>;
}

export class TickScheduler implements IMonitorScheduler {
    private readonly monitors = new Map<string, SchedulerEntry>();
    private tickTimer: NodeJS.Timeout | null = null;
    private activeChecks = 0;

    constructor(
        private readonly tickIntervalMs: number = 1000,
        private readonly maxConcurrentChecks: number = 50,
    ) { }

    add(monitorId: string, intervalMs: number, callback: () => Promise<void>): void {
        const now = Date.now();
        this.monitors.set(monitorId, {
            intervalMs,
            nextCheckAt: now + intervalMs,
            callback,
        });
        log.debug({ monitorId, intervalMs }, "Monitor added to scheduler");
    }

    update(monitorId: string, intervalMs: number): void {
        const entry = this.monitors.get(monitorId);
        if (!entry) {
            log.warn({ monitorId }, "Cannot update unknown monitor");
            return;
        }
        entry.intervalMs = intervalMs;
        entry.nextCheckAt = Date.now() + intervalMs;
        log.debug({ monitorId, intervalMs }, "Monitor updated in scheduler");
    }

    remove(monitorId: string): void {
        this.monitors.delete(monitorId);
        log.debug({ monitorId }, "Monitor removed from scheduler");
    }

    start(): void {
        if (this.tickTimer) return;
        this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);
        log.info(
            { tickIntervalMs: this.tickIntervalMs, maxConcurrentChecks: this.maxConcurrentChecks },
            "Scheduler started",
        );
    }

    stop(): void {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
            log.info("Scheduler stopped");
        }
    }

    getActiveCount(): number {
        return this.monitors.size;
    }

    getActiveChecks(): number {
        return this.activeChecks;
    }

    isRunning(): boolean {
        return this.tickTimer !== null;
    }

    private tick(): void {
        const now = Date.now();
        const dueMonitors = [...this.monitors.entries()]
            .filter(([_, entry]) => now >= entry.nextCheckAt)
            .sort((a, b) => a[1].nextCheckAt - b[1].nextCheckAt);

        for (const [monitorId, entry] of dueMonitors) {
            if (this.activeChecks >= this.maxConcurrentChecks) break;

            this.activeChecks++;
            entry.nextCheckAt = now + entry.intervalMs;

            entry
                .callback()
                .catch((err) => {
                    log.error({ monitorId, err }, "Check callback failed");
                })
                .finally(() => {
                    this.activeChecks--;
                });
        }
    }
}
