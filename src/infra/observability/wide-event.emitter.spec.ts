import { describe, it, expect, vi } from 'vitest';
import { WideEventEmitter } from './wide-event.emitter';
import { MonitorConfig } from '../../domain/value-objects/monitor-config';
import { CheckResult } from '../../domain/value-objects/check-result';
import { logger } from '../config/logger';

vi.mock('../config/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const config: MonitorConfig = {
  monitorId: 1,
  siteId: 10,
  workspaceId: 100,
  url: 'https://example.com',
  protocol: 'https',
  checkIntervalSeconds: 60,
  timeoutSeconds: 30,
};

describe('WideEventEmitter', () => {
  it('should emit info log for successful check', () => {
    const emitter = new WideEventEmitter();

    const result: CheckResult = {
      status: 'up',
      responseTimeMs: 150,
      statusCode: 200,
      errorMessage: null,
      ipAddress: '1.2.3.4',
      tlsCertificateDaysRemaining: 45,
    };

    emitter.emit(config, result, 150);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        wideEvent: expect.objectContaining({
          service: 'uptime-checker-worker',
          operation: 'check.execute',
          monitorId: 1,
          status: 'up',
          outcome: 'ok',
        }),
      }),
      expect.stringContaining('UP'),
    );
  });

  it('should emit error log for failed check', () => {
    const emitter = new WideEventEmitter();

    const result: CheckResult = {
      status: 'down',
      responseTimeMs: 5000,
      statusCode: null,
      errorMessage: 'Timeout after 30000ms',
      ipAddress: null,
      tlsCertificateDaysRemaining: null,
    };

    emitter.emit(config, result, 5000);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        wideEvent: expect.objectContaining({
          outcome: 'error',
          status: 'down',
          error: { message: 'Timeout after 30000ms' },
        }),
      }),
      expect.stringContaining('DOWN'),
    );
  });
});
