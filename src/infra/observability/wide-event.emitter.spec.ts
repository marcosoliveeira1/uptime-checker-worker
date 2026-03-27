import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WideEventEmitter } from './wide-event.emitter';

// Mock the logger
vi.mock('../config/logger', () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
    },
}));

import { logger } from '../config/logger';

describe('WideEventEmitter', () => {
    let emitter: WideEventEmitter;
    const mockJobId = 'job-123';
    const mockTraceId = 'trace-456';

    beforeEach(() => {
        vi.clearAllMocks();
        emitter = new WideEventEmitter(mockJobId, mockTraceId);
    });

    describe('initialization', () => {
        it('should initialize with jobId and optional traceId', () => {
            const event = emitter.getEvent();

            expect(event.jobId).toBe(mockJobId);
            expect(event.traceId).toBe(mockTraceId);
            expect(event.service).toBe('crawler-worker');
            expect(event.operation).toBe('job.process');
            expect(event.status).toBe('success');
            expect(event.outcome).toBe('ok');
        });

        it('should initialize without traceId', () => {
            const emitterNoTrace = new WideEventEmitter(mockJobId);
            const event = emitterNoTrace.getEvent();

            expect(event.jobId).toBe(mockJobId);
            expect(event.traceId).toBeUndefined();
        });
    });

    describe('context setting', () => {
        it('should set input with URL and options', () => {
            const url = 'https://example.com';
            const options = { maxDepth: 3, timeout: 5000 };

            emitter.setInput(url, options);
            const event = emitter.getEvent();

            expect(event.input).toEqual({ url, options });
            expect(event.url).toBe(url);
        });

        it('should set job metadata when job is initialized', () => {
            emitter.setJobMetadata({
                workspaceId: 'ws-1',
                siteId: 123,
                idempotencyKey: 'idem-key',
            });

            const event = emitter.getEvent();
            expect(event.job).toEqual({
                id: mockJobId,
                workspaceId: 'ws-1',
                siteId: 123,
                idempotencyKey: 'idem-key',
            });
        });

        it('should update job metadata on existing job object', () => {
            // First set job metadata
            emitter.setJobMetadata({
                workspaceId: 'ws-1',
                siteId: 123,
            });

            // Then update with more metadata
            emitter.setJobMetadata({
                idempotencyKey: 'idem-key',
            });

            const event = emitter.getEvent();
            expect(event.job).toEqual({
                id: mockJobId,
                workspaceId: 'ws-1',
                siteId: 123,
                idempotencyKey: 'idem-key',
            });
        });

        it('should initialize job object if it was deleted', () => {
            // Manually delete job to test the initialization branch
            const event = emitter.getEvent();
            event.job = undefined;

            // Now call setJobMetadata which should initialize job
            emitter.setJobMetadata({
                workspaceId: 'ws-1',
                siteId: 123,
            });

            const updatedEvent = emitter.getEvent();
            expect(updatedEvent.job).toEqual({
                id: mockJobId,
                workspaceId: 'ws-1',
                siteId: 123,
            });
        });

        it('should set source', () => {
            emitter.setSource('api');
            expect(emitter.getEvent().source).toBe('api');

            emitter.setSource('scheduler');
            expect(emitter.getEvent().source).toBe('scheduler');
        });

        it('should set arbitrary context', () => {
            const context = { custom: 'value', nested: { data: 'here' } };
            emitter.setContext('custom', context);

            const event = emitter.getEvent();
            expect(event['custom']).toEqual(context);
        });
    });

    describe('crawler execution', () => {
        it('should record crawler execution details', () => {
            const crawlerDetails = {
                exitCode: 0,
                duration: 2540,
                outputFiles: {
                    json: '/tmp/output.json',
                    html: '/tmp/report.html',
                    txt: '/tmp/output.txt',
                },
            };

            emitter.setCrawlerExecution(crawlerDetails);
            const event = emitter.getEvent();

            expect(event.crawler).toEqual(crawlerDetails);
        });
    });

    describe('upload tracking', () => {
        it('should add successful upload record', async () => {
            emitter.addUpload({
                type: 'json',
                fileName: 'output.json',
                s3Key: 'jobs/job-123/output.json',
                url: 'https://minio.example.com/output.json',
                duration: 342,
                status: 'success',
            });

            // Uploads are added to internal state but not visible until emit
            await emitter.emit('success');

            const emittedEvent = vi.mocked(logger.info).mock.calls[0][0] as any;
            expect(emittedEvent.wideEvent.uploads).toHaveLength(1);
            expect(emittedEvent.wideEvent.uploads![0]).toEqual({
                type: 'json',
                fileName: 'output.json',
                s3Key: 'jobs/job-123/output.json',
                url: 'https://minio.example.com/output.json',
                duration: 342,
                status: 'success',
            });
        });

        it('should add failed upload record with error', async () => {
            emitter.addUpload({
                type: 'html',
                fileName: 'report.html',
                s3Key: 'jobs/job-123/report.html',
                duration: 100,
                status: 'failure',
                error: 'Connection timeout',
            });

            // Set error to ensure logger.error is called
            emitter.setError(new Error('Upload failed'));

            await emitter.emit('failure');

            const emittedEvent = vi.mocked(logger.error).mock.calls[0][0] as any;
            expect(emittedEvent.wideEvent.uploads).toHaveLength(1);
            expect(emittedEvent.wideEvent.uploads![0].status).toBe('failure');
            expect(emittedEvent.wideEvent.uploads![0].error).toBe('Connection timeout');
        });

        it('should track multiple uploads', async () => {
            emitter.addUpload({
                type: 'json',
                fileName: 'output.json',
                s3Key: 'jobs/job-123/output.json',
                duration: 342,
                status: 'success',
            });

            emitter.addUpload({
                type: 'html',
                fileName: 'report.html',
                s3Key: 'jobs/job-123/report.html',
                duration: 156,
                status: 'success',
            });

            await emitter.emit('success');

            const emittedEvent = vi.mocked(logger.info).mock.calls[0][0] as any;
            expect(emittedEvent.wideEvent.uploads).toHaveLength(2);
        });
    });

    describe('error handling', () => {
        it('should record error with message and code', () => {
            const error = new Error('S3 upload failed');
            emitter.setError(error, 'S3_TIMEOUT');

            const event = emitter.getEvent();
            expect(event.outcome).toBe('error');
            expect(event.status).toBe('failure');
            expect(event.error).toEqual({
                message: 'S3 upload failed',
                code: 'S3_TIMEOUT',
                stack: expect.any(String),
            });
        });

        it('should record error without code', () => {
            const error = new Error('Unknown error occurred');
            emitter.setError(error);

            const event = emitter.getEvent();
            expect(event.error?.message).toBe('Unknown error occurred');
            expect(event.error?.code).toBeUndefined();
        });
    });

    describe('partial success', () => {
        it('should set partial success with custom message', () => {
            const message = 'Job completed with 2 successful and 1 failed uploads';
            emitter.setPartialSuccess(message);

            const event = emitter.getEvent();
            expect(event.outcome).toBe('partial');
            expect(event.status).toBe('partial');
            expect(event.message).toBe(message);
        });

        it('should set partial success with default message', () => {
            emitter.setPartialSuccess();

            const event = emitter.getEvent();
            expect(event.outcome).toBe('partial');
            expect(event.status).toBe('partial');
            expect(event.message).toBe('Job completed with partial success');
        });
    });

    describe('event emission', () => {
        it('should emit success event with logger.info', async () => {
            emitter.setInput('https://example.com');
            emitter.addUpload({
                type: 'json',
                fileName: 'output.json',
                s3Key: 'jobs/job-123/output.json',
                duration: 342,
                status: 'success',
            });

            await emitter.emit('success');

            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    wideEvent: expect.objectContaining({
                        jobId: mockJobId,
                        status: 'success',
                        outcome: 'ok',
                    }),
                }),
                expect.any(String)
            );
            expect(logger.error).not.toHaveBeenCalled();
        });

        it('should emit error event with logger.error', async () => {
            const error = new Error('Job failed');
            emitter.setError(error);

            await emitter.emit('failure');

            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    wideEvent: expect.objectContaining({
                        jobId: mockJobId,
                        status: 'failure',
                        outcome: 'error',
                    }),
                }),
                expect.any(String)
            );
        });

        it('should count successful uploads in emit', async () => {
            emitter.addUpload({
                type: 'json',
                fileName: 'output.json',
                s3Key: 'jobs/job-123/output.json',
                duration: 100,
                status: 'success',
            });
            emitter.addUpload({
                type: 'html',
                fileName: 'report.html',
                s3Key: 'jobs/job-123/report.html',
                duration: 200,
                status: 'failure',
            });

            await emitter.emit('partial');

            const event = emitter.getEvent();
            expect(event.uploads).toHaveLength(2);
            expect(event.metrics?.filesUploaded).toBe(1);
        });

        it('should emit partial event with logger.info', async () => {
            emitter.setPartialSuccess();
            await emitter.emit('partial');

            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    wideEvent: expect.objectContaining({
                        jobId: mockJobId,
                        outcome: 'partial',
                    }),
                }),
                expect.any(String)
            );
        });

        it('should emit event and record timestamp', async () => {
            const beforeEmit = new Date().toISOString();
            await emitter.emit('success');
            const afterEmit = new Date().toISOString();

            const event = emitter.getEvent();
            expect(event.timestamp).toBeDefined();
            expect(new Date(event.timestamp!).getTime()).toBeLessThanOrEqual(new Date(afterEmit).getTime());
            expect(new Date(event.timestamp!).getTime()).toBeGreaterThanOrEqual(new Date(beforeEmit).getTime());
        });

        it('should emit without uploads set', async () => {
            // Emit without adding any uploads
            await emitter.emit('success');

            const event = emitter.getEvent();
            expect(event.uploads).toBeUndefined();
            expect(logger.info).toHaveBeenCalled();
        });

        it('should emit partial event with uploads', async () => {
            emitter.setPartialSuccess('Some uploads failed');
            emitter.addUpload({
                type: 'json',
                fileName: 'output.json',
                s3Key: 'jobs/job-123/output.json',
                duration: 342,
                status: 'success',
            });
            emitter.addUpload({
                type: 'html',
                fileName: 'report.html',
                s3Key: 'jobs/job-123/report.html',
                duration: 100,
                status: 'failure',
                error: 'Upload failed',
            });

            await emitter.emit('partial');

            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    wideEvent: expect.objectContaining({
                        jobId: mockJobId,
                        status: 'partial',
                        outcome: 'partial',
                        uploads: expect.arrayContaining([
                            expect.objectContaining({ status: 'success' }),
                            expect.objectContaining({ status: 'failure' }),
                        ]),
                    }),
                }),
                expect.any(String)
            );
        });

        it('should emit when no metrics', async () => {
            // Delete metrics to test the branch
            const event = emitter.getEvent();
            event.metrics = undefined;

            emitter.addUpload({
                type: 'json',
                fileName: 'output.json',
                s3Key: 'jobs/job-123/output.json',
                duration: 100,
                status: 'success',
            });

            await emitter.emit('success');

            // Should still emit successfully even without metrics
            expect(logger.info).toHaveBeenCalled();
        });

        it('should update metrics on emit', async () => {
            emitter.setContext('metrics', {
                crawlerDuration: 2540,
                uploadDuration: 498,
                filesUploaded: 2,
            });

            await emitter.emit('success');

            const emittedEvent = vi.mocked(logger.info).mock.calls[0][0] as any;
            expect(emittedEvent.wideEvent.metrics).toEqual({
                totalDuration: expect.any(Number),
                crawlerDuration: 2540,
                uploadDuration: 498,
                filesUploaded: 2,
            });
        });

        it('should set filesUploaded count based on uploaded items', async () => {
            emitter.addUpload({
                type: 'json',
                fileName: 'output.json',
                s3Key: 'jobs/job-123/output.json',
                duration: 342,
                status: 'success',
            });
            emitter.addUpload({
                type: 'html',
                fileName: 'report.html',
                s3Key: 'jobs/job-123/report.html',
                duration: 100,
                status: 'failure',
                error: 'Failed',
            });

            await emitter.emit('partial');

            const emittedEvent = vi.mocked(logger.info).mock.calls[0][0] as any;
            expect(emittedEvent.wideEvent.metrics).toEqual({
                totalDuration: expect.any(Number),
                filesUploaded: 1,
            });
        });

        it('should use provided status over internal status', async () => {
            emitter.setPartialSuccess();

            await emitter.emit('success');

            const emittedEvent = vi.mocked(logger.info).mock.calls[0][0] as any;
            expect(emittedEvent.wideEvent.status).toBe('success');
        });

        it('should include timestamp on emit', async () => {
            const beforeEmit = new Date().toISOString();
            await emitter.emit('success');
            const afterEmit = new Date().toISOString();

            const emittedEvent = vi.mocked(logger.info).mock.calls[0][0] as any;
            const eventTimestamp = emittedEvent.wideEvent.timestamp;

            expect(eventTimestamp).toBeDefined();
            expect(eventTimestamp >= beforeEmit).toBeTruthy();
            expect(eventTimestamp <= afterEmit).toBeTruthy();
        });
    });

    describe('edge cases', () => {
        it('should handle emit without any context', async () => {
            await emitter.emit('success');

            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    wideEvent: expect.objectContaining({
                        jobId: mockJobId,
                    }),
                }),
                expect.any(String)
            );
        });

        it('should merge multiple job metadata updates', () => {
            emitter.setJobMetadata({ workspaceId: 'ws-1' });
            emitter.setJobMetadata({ siteId: 123 });

            const event = emitter.getEvent();
            expect(event.job).toEqual({
                id: mockJobId,
                workspaceId: 'ws-1',
                siteId: 123,
            });
        });

        it('should override previous metadata values', () => {
            emitter.setJobMetadata({ workspaceId: 'ws-1', siteId: 100 });
            emitter.setJobMetadata({ siteId: 123 }); // Override siteId

            const event = emitter.getEvent();
            expect(event.job).toEqual({
                id: mockJobId,
                workspaceId: 'ws-1',
                siteId: 123,
            });
        });
    });
});
