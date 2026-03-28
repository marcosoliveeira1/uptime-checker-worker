import { Protocol } from "../value-objects/protocol";
import { UptimeStatus } from "../value-objects/uptime-status";

export interface UptimeWideEvent {
    service: "uptime-checker-worker";
    operation: "check.execute";
    timestamp: string;
    duration: number;

    monitorId: string;
    siteId: string;
    workspaceId: string;
    protocol: Protocol;
    url: string;

    status: UptimeStatus;
    responseTimeMs: number | null;
    statusCode: number | null;
    tlsCertDaysRemaining: number | null;

    outcome: "ok" | "error";
    error?: {
        message: string;
        code?: string;
        stack?: string;
    };

    environment?: {
        nodeEnv?: string;
    };
}
