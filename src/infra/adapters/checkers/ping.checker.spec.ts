import { describe, it, expect, vi, afterEach } from "vitest";
import { MonitorConfig } from "../../../domain/value-objects/monitor-config";

vi.mock("node:child_process", () => ({
    exec: vi.fn(),
}));

import { exec } from "node:child_process";
import { PingChecker } from "./ping.checker";

const mockedExec = vi.mocked(exec);

function createConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
    return {
        monitorId: 1,
        siteId: 10,
        workspaceId: 100,
        url: "http://example.com",
        protocol: "ping",
        checkIntervalSeconds: 60,
        timeoutSeconds: 5,
        ...overrides,
    };
}

describe("PingChecker", () => {
    const checker = new PingChecker();

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("should return UP on successful ping", async () => {
        mockedExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
            cb(
                null,
                "PING example.com (93.184.216.34): 56 data bytes\n64 bytes from 93.184.216.34: icmp_seq=0 ttl=56 time=11.632 ms",
                "",
            );
            return {} as any;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("up");
        expect(result.responseTimeMs).toBeCloseTo(11.632, 1);
        expect(result.ipAddress).toBe("93.184.216.34");
    });

    it("should return DOWN on failed ping", async () => {
        const error = new Error("ping failed") as any;
        error.killed = false;

        mockedExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
            cb(error, "", "Request timeout");
            return {} as any;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("down");
        expect(result.errorMessage).toBeTruthy();
    });

    it("should return DOWN on timeout (killed process)", async () => {
        const error = new Error("killed") as any;
        error.killed = true;

        mockedExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
            cb(error, "", "");
            return {} as any;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("down");
        expect(result.errorMessage).toContain("Timeout");
    });

    it("should handle ping with no RTT match but success", async () => {
        mockedExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
            cb(null, "PING example.com (1.2.3.4): 56 data bytes\nstat bytes received", "");
            return {} as any;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("up");
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should handle Darwin platform correctly", async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

        mockedExec.mockImplementation((cmd: any, _opts: any, cb: any) => {
            expect(cmd).toContain("-t");
            cb(null, "PING example.com (1.2.3.4): seq=0 time=5.123 ms", "");
            return {} as any;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("up");

        Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    it("should extract IP from parentheses correctly", async () => {
        mockedExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
            cb(
                null,
                "PING api.example.com (203.0.113.42): 56 data bytes\n64 bytes from 203.0.113.42: icmp_seq=0 ttl=64 time=12.456 ms",
                "",
            );
            return {} as any;
        });

        const result = await checker.check(createConfig());

        expect(result.ipAddress).toBe("203.0.113.42");
        expect(result.responseTimeMs).toBeCloseTo(12.456, 1);
    });

    it("should return null IP when output has no parenthesized address", async () => {
        mockedExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
            cb(null, "64 bytes from 203.0.113.42: icmp_seq=0 ttl=64 time=12.456 ms", "");
            return {} as any;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("up");
        expect(result.ipAddress).toBeNull();
    });

    it("should use -W flag on non-darwin platforms", async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });

        mockedExec.mockImplementation((cmd: any, _opts: any, cb: any) => {
            expect(cmd).toContain("-W");
            cb(null, "PING example.com (1.2.3.4): seq=0 time=5.123 ms", "");
            return {} as any;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("up");
        Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    it("should handle stderr output on error", async () => {
        const error = new Error("Network error") as any;
        error.killed = false;

        mockedExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
            cb(error, "", "sendto: No route to host");
            return {} as any;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("down");
        expect(result.errorMessage).toContain("sendto");
    });

    it("should fallback to error.message when stderr is empty", async () => {
        const error = new Error("generic ping failure") as any;
        error.killed = false;

        mockedExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
            cb(error, "", "");
            return {} as any;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("down");
        expect(result.errorMessage).toBe("generic ping failure");
    });
});
