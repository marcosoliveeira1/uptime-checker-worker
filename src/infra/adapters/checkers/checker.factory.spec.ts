import { describe, it, expect } from "vitest";
import { CheckerFactory } from "./checker.factory";
import { Protocol } from "../../../domain/value-objects/protocol";

describe("CheckerFactory", () => {
    const factory = new CheckerFactory();

    it("should return HTTP checker for http protocol", () => {
        const checker = factory.getChecker(Protocol.HTTP);
        expect(checker).toBeDefined();
    });

    it("should return HTTP checker for https protocol (same instance)", () => {
        const checkerHttp = factory.getChecker(Protocol.HTTP);
        const checkerHttps = factory.getChecker(Protocol.HTTPS);
        expect(checkerHttps).toBe(checkerHttp);
    });

    it("should return TCP checker for tcp protocol", () => {
        const checker = factory.getChecker(Protocol.TCP);
        expect(checker).toBeDefined();
    });

    it("should return Ping checker for ping protocol", () => {
        const checker = factory.getChecker(Protocol.PING);
        expect(checker).toBeDefined();
    });

    it("should return DNS checker for dns protocol", () => {
        const checker = factory.getChecker(Protocol.DNS);
        expect(checker).toBeDefined();
    });

    it("should throw error for unknown protocol", () => {
        expect(() => factory.getChecker("unknown" as any)).toThrow("No checker for protocol");
    });
});
