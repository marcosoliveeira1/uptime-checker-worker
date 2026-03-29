export interface IMonitorScheduler {
    add(
        monitorId: string,
        intervalMs: number,
        callback: () => Promise<void>,
    ): void;
    update(monitorId: string, intervalMs: number): void;
    remove(monitorId: string): void;
    start(): void;
    stop(): void;
    getActiveCount(): number;
    getActiveChecks(): number;
}
