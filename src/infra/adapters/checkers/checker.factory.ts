import type { IUptimeChecker } from "../../../domain/interfaces/uptime-checker.interface";
import { Protocol } from "../../../domain/value-objects/protocol";
import { DnsChecker } from "./dns.checker";
import { HttpChecker } from "./http.checker";
import { PingChecker } from "./ping.checker";
import { TcpChecker } from "./tcp.checker";

export class CheckerFactory {
    private readonly checkers: Map<Protocol, IUptimeChecker>;

    constructor() {
        const httpChecker = new HttpChecker();

        this.checkers = new Map<Protocol, IUptimeChecker>([
            [Protocol.HTTP, httpChecker],
            [Protocol.HTTPS, httpChecker],
            [Protocol.TCP, new TcpChecker()],
            [Protocol.PING, new PingChecker()],
            [Protocol.DNS, new DnsChecker()],
        ]);
    }

    getChecker(protocol: Protocol): IUptimeChecker {
        const checker = this.checkers.get(protocol);
        if (!checker) {
            throw new Error(`No checker for protocol: ${protocol}`);
        }
        return checker;
    }
}
