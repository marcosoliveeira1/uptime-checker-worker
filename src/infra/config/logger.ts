import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';
export const isDebugLoggingEnabled = isDevelopment;

/**
 * Logger instance
 * 
 * In development: Pretty-printed console output
 * In production: Structured JSON for log aggregation
 */
export const logger = pino(
    {
        level: process.env.LOG_LEVEL || 'info',
        timestamp: pino.stdTimeFunctions.isoTime,
    },
    isDevelopment
        ? pino.transport({
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
                singleLine: false,
            },
        })
        : undefined
);

function createConditionalChildLogger(bindings: Record<string, string>) {
    const child = logger.child(bindings);

    // Production policy: keep only canonical logs emitted directly by WideEventEmitter.
    if (!isDebugLoggingEnabled) {
        child.level = 'silent';
    }

    return child;
}

/**
 * Child loggers with context
 * Usage: jobLogger = logger.child({ jobId: jobId })
 */
export function createJobLogger(jobId: string) {
    return createConditionalChildLogger({ jobId, context: 'job' });
}

export function createAdapterLogger(adapter: string) {
    return createConditionalChildLogger({ adapter, context: 'adapter' });
}

export function createServiceLogger(service: string) {
    return createConditionalChildLogger({ service, context: 'service' });
}
