import pino from "pino";

const isDevelopment = process.env.NODE_ENV !== "production";
export const isDebugLoggingEnabled = isDevelopment;

export const logger = pino(
    {
        level: process.env.LOG_LEVEL || "info",
        timestamp: pino.stdTimeFunctions.isoTime,
    },
    isDevelopment
        ? pino.transport({
              target: "pino-pretty",
              options: {
                  colorize: true,
                  translateTime: "SYS:standard",
                  ignore: "pid,hostname",
                  singleLine: false,
              },
          })
        : undefined,
);

function createConditionalChildLogger(bindings: Record<string, string>) {
    const child = logger.child(bindings);

    if (!isDebugLoggingEnabled) {
        child.level = "silent";
    }

    return child;
}

export function createServiceLogger(service: string) {
    return createConditionalChildLogger({ service, context: "service" });
}

export function createAdapterLogger(adapter: string) {
    return createConditionalChildLogger({ adapter, context: "adapter" });
}

export function createCheckerLogger(protocol: string) {
    return createConditionalChildLogger({ protocol, context: "checker" });
}

export function createSchedulerLogger() {
    return createConditionalChildLogger({ context: "scheduler" });
}
