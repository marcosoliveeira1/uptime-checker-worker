/**
 * Wide Event: A context-rich, high-dimensional event emitted per request/job
 * Contains all relevant business, infrastructure, and operational context
 * 
 * See: https://boristane.com/blog/observability-wide-events-101/
 */
export interface WideEvent {
    // Core Request/Job Metadata
    jobId: string;
    traceId?: string; // For distributed tracing across services
    service: string;
    operation: string; // e.g., "crawl.execute", "crawl.upload"
    timestamp: string;
    duration?: number; // milliseconds

    // Request/Job Details
    url?: string;
    source?: 'manual' | 'scheduled';
    status: 'success' | 'failure' | 'partial';
    statusCode?: number;
    message?: string;

    // Outcome Details
    outcome: 'ok' | 'error' | 'partial';
    error?: {
        message: string;
        code?: string;
        stack?: string;
    };

    // Input Context
    input?: {
        url?: string;
        options?: Record<string, unknown>;
    };

    // Crawler Execution
    crawler?: {
        exitCode?: number;
        duration?: number;
        outputFiles?: {
            json?: string;
            html?: string;
            txt?: string;
        };
        bytesProcessed?: number;
        pagesScanned?: number;
    };

    // Upload Details
    uploads?: Array<{
        type: 'json' | 'html' | 'txt';
        fileName: string;
        s3Key: string;
        url?: string;
        bytes?: number;
        duration?: number;
        status: 'success' | 'failure';
        error?: string;
    }>;

    // Environment & Infrastructure
    environment?: {
        nodeEnv?: string;
        version?: string;
    };

    // Job-specific Business Context
    job?: {
        id: string;
        workspaceId?: string;
        siteId?: number;
        retryCount?: number;
        idempotencyKey?: string;
    };

    // Metrics
    metrics?: {
        totalDuration: number;
        crawlerDuration?: number;
        uploadDuration?: number;
        filesUploaded?: number;
        filesCleanedUp?: number;
    };

    // Custom/Additional Context
    [key: string]: unknown;
}
