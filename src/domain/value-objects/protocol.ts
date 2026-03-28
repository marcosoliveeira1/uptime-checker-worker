export const Protocol = {
    HTTP: "http",
    HTTPS: "https",
    TCP: "tcp",
    PING: "ping",
    DNS: "dns",
} as const;

export type Protocol = (typeof Protocol)[keyof typeof Protocol];
