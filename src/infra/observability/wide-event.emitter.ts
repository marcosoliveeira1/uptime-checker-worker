import { logger } from '../config/logger';
import { WideEvent } from '../../domain/events/wide-event';

/**
 * WideEventEmitter: Accumulates context throughout a job lifecycle and emits a wide event
 * 
 * Usage:
 * const emitter = new WideEventEmitter(jobId);
 * emitter.setContext('crawler', { duration: 1000 });
 * emitter.addUpload({ type: 'json', fileName: '...', status: 'success' });
 * await emitter.emit('success');
 */
export class WideEventEmitter {
    private startTime = Date.now();
    private event: WideEvent;
    private uploads: Exclude<WideEvent['uploads'], undefined> = [];

    constructor(jobId: string, traceId?: string) {
        this.event = {
            jobId,
            traceId,
            service: 'crawler-worker',
            operation: 'job.process',
            timestamp: new Date().toISOString(),
            status: 'success',
            outcome: 'ok',
            job: { id: jobId },
            metrics: {
                totalDuration: 0,
            },
        };
    }

    /**
     * Set context for the job (URL, options, etc.)
     */
    setInput(url: string, options?: Record<string, unknown>) {
        this.event.input = { url, options };
        this.event.url = url;
    }

    /**
     * Set job metadata from the original event
     */
    setJobMetadata(metadata: Partial<Exclude<WideEvent['job'], undefined>>) {
        if (!this.event.job) {
            this.event.job = { id: this.event.jobId };
        }
        this.event.job = {
            ...this.event.job,
            ...metadata
        };
    }

    /**
     * Set source of the job
     */
    setSource(source: 'api' | 'event' | 'webhook' | 'scheduler' | 'manual' | 'scheduled') {
        this.event.source = source as any;
    }

    /**
     * Add context from a sub-operation (crawler, upload, etc.)
     */
    setContext(key: string, context: Record<string, unknown>) {
        this.event[key] = context;
    }

    /**
     * Record a file upload attempt
     */
    addUpload(upload: Exclude<WideEvent['uploads'], undefined>[0]) {
        this.uploads.push(upload);
    }

    /**
     * Record a crawler execution
     */
    setCrawlerExecution(details: WideEvent['crawler']) {
        this.event.crawler = details;
    }

    /**
     * Record an error
     */
    setError(error: Error, code?: string) {
        this.event.outcome = 'error';
        this.event.status = 'failure';
        this.event.error = {
            message: error.message,
            code,
            stack: error.stack,
        };
    }

    /**
     * Mark job as partially successful (some uploads failed)
     */
    setPartialSuccess(message?: string) {
        this.event.outcome = 'partial';
        this.event.status = 'partial';
        this.event.message = message || 'Job completed with partial success';
    }

    /**
     * Emit the wide event to the logger
     */
    async emit(status?: 'success' | 'failure' | 'partial'): Promise<void> {
        const endTime = Date.now();
        const totalDuration = endTime - this.startTime;

        this.event.timestamp = new Date().toISOString();
        this.event.status = status || this.event.status;
        if (this.event.metrics) {
            this.event.metrics.totalDuration = totalDuration;
        }

        if (this.uploads.length > 0) {
            this.event.uploads = this.uploads;
            if (this.event.metrics) {
                this.event.metrics.filesUploaded = this.uploads.filter(
                    (u) => u.status === 'success'
                ).length;
            }
        }

        // Emit as structured log using Pino
        // In production, this structured event can be easily queried and analyzed
        const logLevel =
            this.event.outcome === 'error' ? 'error' : 'info';

        logger[logLevel as 'info' | 'error'](
            {
                wideEvent: this.event,
            },
            `Job ${this.event.jobId} - ${this.event.outcome.toUpperCase()}`
        );
    }

    /**
     * Get the current event object (for testing or introspection)
     */
    getEvent(): WideEvent {
        return this.event;
    }
}
