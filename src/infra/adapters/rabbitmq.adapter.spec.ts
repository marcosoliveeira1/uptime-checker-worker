import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RabbitMQAdapter } from "./rabbitmq.adapter";
import * as amqp from "amqplib";

vi.mock("amqplib");

const mockedAmqp = vi.mocked(amqp);

function createMockChannel() {
    return {
        prefetch: vi.fn().mockResolvedValue(undefined),
        assertExchange: vi.fn().mockResolvedValue(undefined),
        assertQueue: vi.fn().mockResolvedValue(undefined),
        bindQueue: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn(),
        consume: vi.fn().mockResolvedValue(undefined),
        ack: vi.fn(),
        nack: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function createMockConnection(channel: ReturnType<typeof createMockChannel>) {
    const handlers: Record<string, (...args: any[]) => void> = {};
    return {
        createChannel: vi.fn().mockResolvedValue(channel),
        close: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, cb: (...args: any[]) => void) => {
            handlers[event] = cb;
        }),
        handlers,
    };
}

describe("RabbitMQAdapter", () => {
    let adapter: RabbitMQAdapter;

    beforeEach(() => {
        vi.clearAllMocks();
        adapter = new RabbitMQAdapter("amqp://localhost:5672", 10);
    });

    afterEach(async () => {
        try {
            await adapter.disconnect();
        } catch {
            // Already disconnected or never connected
        }
    });

    describe("connect", () => {
        it("should connect and setup topology", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);

            mockedAmqp.connect.mockResolvedValue(mockConnection as any);

            await adapter.connect();

            expect(mockedAmqp.connect).toHaveBeenCalledWith("amqp://localhost:5672");
            expect(mockChannel.prefetch).toHaveBeenCalledWith(10);
            expect(mockChannel.assertExchange).toHaveBeenCalledTimes(2);
            expect(mockChannel.assertQueue).toHaveBeenCalledTimes(2);
            expect(mockChannel.bindQueue).toHaveBeenCalledTimes(3);
            expect(adapter.isConnected()).toBe(true);
        });

        it("should set up correct bindings", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);

            mockedAmqp.connect.mockResolvedValue(mockConnection as any);

            await adapter.connect();

            expect(mockChannel.bindQueue).toHaveBeenCalledWith(
                "uptime.commands.pending",
                "uptime.commands",
                "site.add",
            );
            expect(mockChannel.bindQueue).toHaveBeenCalledWith(
                "uptime.commands.pending",
                "uptime.commands",
                "site.update",
            );
            expect(mockChannel.bindQueue).toHaveBeenCalledWith(
                "uptime.commands.pending",
                "uptime.commands",
                "site.remove",
            );
        });

        it("should handle connection error and retry", async () => {
            vi.useFakeTimers();
            mockedAmqp.connect.mockRejectedValueOnce(new Error("Connection failed"));
            mockedAmqp.connect.mockResolvedValueOnce(
                createMockConnection(createMockChannel()) as any,
            );

            const connectPromise = adapter.connect();
            await expect(connectPromise).rejects.toThrow("Connection failed");

            await vi.advanceTimersByTimeAsync(5000);

            expect(mockedAmqp.connect).toHaveBeenCalledTimes(2);
            expect(adapter.isConnected()).toBe(true);
            vi.useRealTimers();
        });

        it("should reconnect when connection emits error or close", async () => {
            vi.useFakeTimers();
            const ch1 = createMockChannel();
            const ch2 = createMockChannel();
            const conn1 = createMockConnection(ch1);
            const conn2 = createMockConnection(ch2);

            mockedAmqp.connect
                .mockResolvedValueOnce(conn1 as any)
                .mockResolvedValueOnce(conn2 as any);

            await adapter.connect();
            expect(adapter.isConnected()).toBe(true);

            conn1.handlers.error(new Error("boom"));
            conn1.handlers.close();

            await vi.advanceTimersByTimeAsync(5000);
            expect(mockedAmqp.connect).toHaveBeenCalledTimes(2);
            vi.useRealTimers();
        });
    });

    describe("publish", () => {
        it("should publish message when connected", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);

            mockedAmqp.connect.mockResolvedValue(mockConnection as any);
            await adapter.connect();

            const message = { monitor_id: "mon_01ARZ3NDEKTSV4RRFFQ69G5FAV", status: "up" };
            await adapter.publish("uptime.results", "check.completed", message);

            expect(mockChannel.publish).toHaveBeenCalledWith(
                "uptime.results",
                "check.completed",
                expect.any(Buffer),
                expect.objectContaining({ persistent: true, contentType: "application/json" }),
            );
        });

        it("should buffer messages when disconnected", async () => {
            const message = { monitor_id: "mon_01ARZ3NDEKTSV4RRFFQ69G5FAV", status: "up" };
            await adapter.publish("uptime.results", "check.completed", message);

            expect(adapter.isConnected()).toBe(false);
            expect((adapter as any).buffer).toHaveLength(1);
        });

        it("should not buffer beyond max size", async () => {
            for (let i = 0; i < 1001; i++) {
                await adapter.publish("uptime.results", "check.completed", { id: i });
            }

            expect((adapter as any).buffer).toHaveLength(1000);
        });

        it("should drain buffered messages after connecting", async () => {
            const message = { monitor_id: "mon_02BRY4OFLUXV5SSGGG75H6GBW", status: "up" };
            await adapter.publish("uptime.results", "check.completed", message);

            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);
            mockedAmqp.connect.mockResolvedValue(mockConnection as any);

            await adapter.connect();

            expect(mockChannel.publish).toHaveBeenCalledTimes(1);
            expect((adapter as any).buffer).toHaveLength(0);
        });

        it("should keep remaining buffer when disconnected during drain", async () => {
            const msg1 = {
                exchange: "uptime.results",
                routingKey: "first",
                content: Buffer.from(JSON.stringify({ id: 1 })),
            };
            const msg2 = {
                exchange: "uptime.results",
                routingKey: "second",
                content: Buffer.from(JSON.stringify({ id: 2 })),
            };

            (adapter as any).buffer = [msg1, msg2];
            (adapter as any).channel = createMockChannel();
            (adapter as any).connected = false;

            await (adapter as any).drainBuffer();

            expect((adapter as any).buffer).toEqual([msg1]);
        });
    });

    describe("subscribeWithRouting", () => {
        it("should handle messages with routing keys", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);

            mockedAmqp.connect.mockResolvedValue(mockConnection as any);
            await adapter.connect();

            const handler = vi.fn().mockResolvedValue(undefined);
            await adapter.subscribeWithRouting("uptime.commands.pending", handler);

            const consumeFn = mockChannel.consume.mock.calls[0][1];
            await consumeFn({
                content: Buffer.from(JSON.stringify({ type: "site.add" })),
                fields: { routingKey: "site.add" },
            });

            expect(handler).toHaveBeenCalledWith({
                content: { type: "site.add" },
                routingKey: "site.add",
            });
            expect(mockChannel.ack).toHaveBeenCalledTimes(1);
        });

        it("should nack when routing handler throws", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);
            mockedAmqp.connect.mockResolvedValue(mockConnection as any);
            await adapter.connect();

            const handler = vi.fn().mockRejectedValue(new Error("boom"));
            await adapter.subscribeWithRouting("uptime.commands.pending", handler);
            const consumeFn = mockChannel.consume.mock.calls[0][1];

            await consumeFn({
                content: Buffer.from(JSON.stringify({ type: "site.add" })),
                fields: { routingKey: "site.add" },
            });

            expect(mockChannel.nack).toHaveBeenCalledTimes(1);
        });

        it("should ignore null consumed message", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);
            mockedAmqp.connect.mockResolvedValue(mockConnection as any);
            await adapter.connect();

            await adapter.subscribeWithRouting("uptime.commands.pending", vi.fn());
            const consumeFn = mockChannel.consume.mock.calls[0][1];

            await consumeFn(null);

            expect(mockChannel.ack).not.toHaveBeenCalled();
            expect(mockChannel.nack).not.toHaveBeenCalled();
        });

        it("should throw if channel is not initialized", async () => {
            await expect(
                adapter.subscribeWithRouting("uptime.commands.pending", vi.fn()),
            ).rejects.toThrow("Channel not initialized");
        });
    });

    describe("subscribe", () => {
        it("should consume and ack message on success", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);
            mockedAmqp.connect.mockResolvedValue(mockConnection as any);
            await adapter.connect();

            const handler = vi.fn().mockResolvedValue(undefined);
            await adapter.subscribe("uptime.results", handler);

            const consumeFn = mockChannel.consume.mock.calls[0][1];
            await consumeFn({
                content: Buffer.from(JSON.stringify({ ok: true })),
                fields: { routingKey: "check.completed" },
            });

            expect(handler).toHaveBeenCalledWith({ ok: true });
            expect(mockChannel.ack).toHaveBeenCalledTimes(1);
        });

        it("should nack message when parsing fails", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);
            mockedAmqp.connect.mockResolvedValue(mockConnection as any);
            await adapter.connect();

            await adapter.subscribe("uptime.results", vi.fn());
            const consumeFn = mockChannel.consume.mock.calls[0][1];
            await consumeFn({ content: Buffer.from("not-json"), fields: { routingKey: "x" } });

            expect(mockChannel.nack).toHaveBeenCalledTimes(1);
        });

        it("should throw if channel is not initialized", async () => {
            await expect(adapter.subscribe("uptime.results", vi.fn())).rejects.toThrow(
                "Channel not initialized",
            );
        });
    });

    describe("ack/nack", () => {
        it("should ack messages when connected", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);

            mockedAmqp.connect.mockResolvedValue(mockConnection as any);
            await adapter.connect();

            const mockMessage = {};
            adapter.ack(mockMessage);

            expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
        });

        it("should nack with requeue option", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);

            mockedAmqp.connect.mockResolvedValue(mockConnection as any);
            await adapter.connect();

            const mockMessage = {};
            adapter.nack(mockMessage, true);

            expect(mockChannel.nack).toHaveBeenCalledWith(mockMessage, false, true);
        });

        it("should no-op ack and nack when channel is missing", () => {
            expect(() => adapter.ack({})).not.toThrow();
            expect(() => adapter.nack({}, true)).not.toThrow();
        });
    });

    describe("disconnect", () => {
        it("should close connections properly", async () => {
            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);

            mockedAmqp.connect.mockResolvedValue(mockConnection as any);
            await adapter.connect();

            await adapter.disconnect();

            expect(mockChannel.close).toHaveBeenCalled();
            expect(mockConnection.close).toHaveBeenCalled();
            expect(adapter.isConnected()).toBe(false);
        });

        it("should clear pending reconnect timeout on disconnect", async () => {
            vi.useFakeTimers();
            const ch1 = createMockChannel();
            const conn1 = createMockConnection(ch1);
            mockedAmqp.connect.mockResolvedValue(conn1 as any);

            await adapter.connect();
            conn1.handlers.error(new Error("lost"));

            await adapter.disconnect();
            await vi.advanceTimersByTimeAsync(5000);

            expect(mockedAmqp.connect).toHaveBeenCalledTimes(1);
            vi.useRealTimers();
        });
    });

    describe("isConnected", () => {
        it("should report connection status", async () => {
            expect(adapter.isConnected()).toBe(false);

            const mockChannel = createMockChannel();
            const mockConnection = createMockConnection(mockChannel);

            mockedAmqp.connect.mockResolvedValue(mockConnection as any);
            await adapter.connect();

            expect(adapter.isConnected()).toBe(true);
        });

        it("should throw when topology is setup without channel", async () => {
            await expect((adapter as any).setupTopology()).rejects.toThrow(
                "Channel not initialized",
            );
        });
    });
});
