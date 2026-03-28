import net from "node:net";
import { IUptimeChecker } from "../../../domain/interfaces/uptime-checker.interface";
import { MonitorConfig } from "../../../domain/value-objects/monitor-config";
import { CheckResult } from "../../../domain/value-objects/check-result";
import { UptimeStatus } from "../../../domain/value-objects/uptime-status";

export class TcpChecker implements IUptimeChecker {
    async check(config: MonitorConfig): Promise<CheckResult> {
        const startTime = Date.now();
        const timeoutMs = config.timeoutSeconds * 1000;

        const url = new URL(config.url);
        const host = url.hostname;
        const port = parseInt(url.port, 10) || 80;

        return new Promise<CheckResult>((resolve) => {
            const socket = net.connect({ host, port }, () => {
                const responseTimeMs = Date.now() - startTime;
                const ipAddress = socket.remoteAddress ?? null;
                socket.destroy();

                resolve({
                    status: UptimeStatus.UP,
                    responseTimeMs,
                    statusCode: null,
                    errorMessage: null,
                    ipAddress,
                    tlsCertificateDaysRemaining: null,
                    sslExpiryWarning: false,
                });
            });

            socket.setTimeout(timeoutMs);

            socket.on("timeout", () => {
                socket.destroy();
                resolve({
                    status: UptimeStatus.DOWN,
                    responseTimeMs: Date.now() - startTime,
                    statusCode: null,
                    errorMessage: `Timeout after ${timeoutMs}ms`,
                    ipAddress: null,
                    tlsCertificateDaysRemaining: null,
                    sslExpiryWarning: false,
                });
            });

            socket.on("error", (err: Error) => {
                socket.destroy();
                resolve({
                    status: UptimeStatus.DOWN,
                    responseTimeMs: Date.now() - startTime,
                    statusCode: null,
                    errorMessage: err.message,
                    ipAddress: null,
                    tlsCertificateDaysRemaining: null,
                    sslExpiryWarning: false,
                });
            });
        });
    }
}
