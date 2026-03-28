export const UptimeStatus = {
    UP: "up",
    DOWN: "down",
    DEGRADED: "degraded",
} as const;

export type UptimeStatus = (typeof UptimeStatus)[keyof typeof UptimeStatus];
