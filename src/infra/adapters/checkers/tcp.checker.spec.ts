import { describe, it, expect, vi, afterEach } from "vitest";
import { TcpChecker } from "./tcp.checker";
import { MonitorConfig } from "../../../domain/value-objects/monitor-config";
import net from "node:net";
import { EventEmitter } from "node:events";

function createConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
    return {
        monitorId: "mon_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        siteId: "site_01ARZ3NDEKTSV4RRFFQ69G5FB0",
        workspaceId: "ws_01ARZ3NDEKTSV4RRFFQ69G5FB1",
        url: "tcp://example.com:3306",
        protocol: "tcp",
        checkIntervalSeconds: 60,
        timeoutSeconds: 5,
        ...overrides,
    };
}

describe("TcpChecker", () => {
    const checker = new TcpChecker();

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should return UP on successful connect", async () => {
        const mockSocket = new EventEmitter() as any;
        mockSocket.remoteAddress = "1.2.3.4";
        mockSocket.setTimeout = vi.fn();
        mockSocket.destroy = vi.fn();

        vi.spyOn(net, "connect").mockImplementation((_opts: any, cb: any) => {
            process.nextTick(() => cb());
            return mockSocket;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("up");
        expect(result.ipAddress).toBe("1.2.3.4");
        expect(result.errorMessage).toBeNull();
    });

    it("should return DOWN on connection error", async () => {
        const mockSocket = new EventEmitter() as any;
        mockSocket.setTimeout = vi.fn();
        mockSocket.destroy = vi.fn();

        vi.spyOn(net, "connect").mockImplementation((_opts: any, _cb: any) => {
            process.nextTick(() => mockSocket.emit("error", new Error("ECONNREFUSED")));
            return mockSocket;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("down");
        expect(result.errorMessage).toBe("ECONNREFUSED");
    });

    it("should return DOWN on timeout", async () => {
        const mockSocket = new EventEmitter() as any;
        mockSocket.setTimeout = vi.fn();
        mockSocket.destroy = vi.fn();

        vi.spyOn(net, "connect").mockImplementation((_opts: any, _cb: any) => {
            process.nextTick(() => mockSocket.emit("timeout"));
            return mockSocket;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("down");
        expect(result.errorMessage).toContain("Timeout");
    });

    it("should parse port from URL correctly", async () => {
        const mockSocket = new EventEmitter() as any;
        mockSocket.remoteAddress = "1.2.3.4";
        mockSocket.setTimeout = vi.fn();
        mockSocket.destroy = vi.fn();

        const connectSpy = vi.spyOn(net, "connect").mockImplementation((_opts: any, cb: any) => {
            process.nextTick(() => cb());
            return mockSocket;
        });

        await checker.check(createConfig({ url: "tcp://db.example.com:5432" }));

        expect(connectSpy).toHaveBeenCalledWith(
            expect.objectContaining({ host: "db.example.com", port: 5432 }),
            expect.any(Function),
        );
    });

    it("should handle default port when not specified", async () => {
        const mockSocket = new EventEmitter() as any;
        mockSocket.remoteAddress = "1.2.3.4";
        mockSocket.setTimeout = vi.fn();
        mockSocket.destroy = vi.fn();

        const connectSpy = vi.spyOn(net, "connect").mockImplementation((_opts: any, cb: any) => {
            process.nextTick(() => cb());
            return mockSocket;
        });

        await checker.check(createConfig({ url: "tcp://db.example.com" }));

        expect(connectSpy).toHaveBeenCalledWith(
            expect.objectContaining({ host: "db.example.com", port: 80 }),
            expect.any(Function),
        );
    });

    it("should handle undefined remoteAddress", async () => {
        const mockSocket = new EventEmitter() as any;
        mockSocket.remoteAddress = undefined;
        mockSocket.setTimeout = vi.fn();
        mockSocket.destroy = vi.fn();

        vi.spyOn(net, "connect").mockImplementation((_opts: any, cb: any) => {
            process.nextTick(() => cb());
            return mockSocket;
        });

        const result = await checker.check(createConfig());

        expect(result.status).toBe("up");
        expect(result.ipAddress).toBeNull();
    });
});
