export interface IMonitorScheduler {
    add(monitorId: number, intervalMs: number, callback: () => Promise<void>): void;
    update(monitorId: number, intervalMs: number): void;
    remove(monitorId: number): void;
    start(): void;
    stop(): void;
    getActiveCount(): number;
    getActiveChecks(): number;
}
