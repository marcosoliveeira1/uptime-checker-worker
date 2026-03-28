import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpChecker } from './http.checker';
import { MonitorConfig } from '../../../domain/value-objects/monitor-config';
import http from 'node:http';
import https from 'node:https';
import { TLSSocket } from 'node:tls';
import { EventEmitter, PassThrough } from 'node:stream';

function createConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    monitorId: 'mon_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    siteId: 'site_01ARZ3NDEKTSV4RRFFQ69G5FB0',
    workspaceId: 'ws_01ARZ3NDEKTSV4RRFFQ69G5FB1',
    url: 'http://example.com',
    protocol: 'http',
    checkIntervalSeconds: 60,
    timeoutSeconds: 5,
    ...overrides,
  };
}

describe('HttpChecker', () => {
  let checker: HttpChecker;

  beforeEach(() => {
    vi.clearAllMocks();
    checker = new HttpChecker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return UP for 200 response', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: '93.184.216.34' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      req.on = req.on.bind(req);
      return req;
    });

    const result = await checker.check(createConfig());

    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(200);
    expect(result.ipAddress).toBe('93.184.216.34');
    expect(result.errorMessage).toBeNull();
  });

  it('should return DOWN for non-200 response', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 500;
    mockResponse.socket = { remoteAddress: '93.184.216.34' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig());

    expect(result.status).toBe('down');
    expect(result.statusCode).toBe(500);
    expect(result.errorMessage).toContain('200');
  });

  it('should return DOWN on request error', async () => {
    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, _cb: any) => {
      const req = new EventEmitter() as any;
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
      return req;
    });

    const result = await checker.check(createConfig());

    expect(result.status).toBe('down');
    expect(result.errorMessage).toBe('ECONNREFUSED');
  });

  it('should return DOWN when keyword not found', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => {
        cb(mockResponse);
        mockResponse.emit('data', 'Hello World');
        mockResponse.emit('end');
      });
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig({ keywordCheck: 'NotFound' }));

    expect(result.status).toBe('down');
    expect(result.errorMessage).toBe('Keyword not found');
  });

  it('should return UP when keyword found', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => {
        cb(mockResponse);
        mockResponse.emit('data', 'Hello World');
        mockResponse.emit('end');
      });
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig({ keywordCheck: 'Hello' }));

    expect(result.status).toBe('up');
    expect(result.errorMessage).toBeNull();
  });

  it('should measure response time correctly', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig());

    expect(result.status).toBe('up');
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.statusCode).toBe(200);
  });

  it('should use HTTPS for https protocol', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    const httpsSpy = vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(
      createConfig({
        protocol: 'https',
        url: 'https://example.com',
      }),
    );

    expect(httpsSpy).toHaveBeenCalled();
    expect(result.status).toBe('up');
  });

  it('should handle custom expected status code', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 201;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig({ expectedStatusCode: 201 }));

    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(201);
  });

  it('should handle request abort on timeout', async () => {
    vi.useFakeTimers();
    const mockReq = new EventEmitter() as any;

    vi.spyOn(http, 'get').mockImplementation((_url: any, opts: any, _cb: any) => {
      opts.signal.addEventListener('abort', () => {
        mockReq.emit('error', new Error('Request aborted'));
      });
      return mockReq;
    });

    const resultPromise = checker.check(createConfig({ timeoutSeconds: 1 }));
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(result.status).toBe('down');
    expect(result.errorMessage).toBe('Timeout after 1000ms');
    vi.useRealTimers();
  });

  it('should handle socket without remoteAddress', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: undefined };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig());

    expect(result.status).toBe('up');
    expect(result.ipAddress).toBeNull();
  });

  it('should handle response without socket', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = undefined;

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig());

    expect(result.status).toBe('up');
    expect(result.ipAddress).toBeNull();
  });

  it('should handle large response body with keyword', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => {
        cb(mockResponse);
        // Simulate large response
        for (let i = 0; i < 100; i++) {
          mockResponse.emit('data', 'x'.repeat(1024));
        }
        mockResponse.emit('data', 'FOUND_KEYWORD');
        mockResponse.emit('end');
      });
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig({ keywordCheck: 'FOUND_KEYWORD' }));

    expect(result.status).toBe('up');
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should drain response when no keyword check', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    const resumeSpy = vi.fn();
    mockResponse.resume = resumeSpy;

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig());

    expect(result.status).toBe('up');
    expect(resumeSpy).toHaveBeenCalled();
  });

  it('should capture HTTP error details', async () => {
    const mockReq = new EventEmitter() as any;

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, _cb: any) => {
      process.nextTick(() =>
        mockReq.emit('error', new Error('ECONNRESET: Connection reset by peer')),
      );
      return mockReq;
    });

    const result = await checker.check(createConfig());

    expect(result.status).toBe('down');
    expect(result.errorMessage).toContain('ECONNRESET');
  });

  it('should handle null statusCode', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = undefined;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig());

    expect(result.statusCode).toBe(0);
    expect(result.status).toBe('down');
  });

  it('should return DEGRADED when response exceeds threshold', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(120000);

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig());

    expect(result.status).toBe('degraded');
    dateNowSpy.mockRestore();
  });

  it('should extract TLS certificate days when valid_to exists', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    const socket = Object.create(TLSSocket.prototype) as TLSSocket & { remoteAddress?: string };
    Object.defineProperty(socket, 'remoteAddress', { get: () => '8.8.8.8' });
    (socket as any).getPeerCertificate = vi.fn().mockReturnValue({ valid_to: 'Jan 01 2099 GMT' });
    mockResponse.socket = socket;

    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(
      createConfig({ protocol: 'https', url: 'https://example.com' }),
    );

    expect(result.status).toBe('up');
    expect(result.tlsCertificateDaysRemaining).toBeTypeOf('number');
  });

  it('should ignore TLS extraction errors and keep check successful', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    const socket = Object.create(TLSSocket.prototype) as TLSSocket & { remoteAddress?: string };
    Object.defineProperty(socket, 'remoteAddress', { get: () => '8.8.4.4' });
    (socket as any).getPeerCertificate = vi.fn().mockImplementation(() => {
      throw new Error('cert parse error');
    });
    mockResponse.socket = socket;

    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(
      createConfig({ protocol: 'https', url: 'https://example.com' }),
    );

    expect(result.status).toBe('up');
    expect(result.tlsCertificateDaysRemaining).toBeNull();
  });

  it('should handle synchronous client.get exceptions', async () => {
    vi.spyOn(http, 'get').mockImplementation(() => {
      throw new Error('sync failure');
    });

    const result = await checker.check(createConfig());

    expect(result.status).toBe('down');
    expect(result.errorMessage).toBe('sync failure');
  });

  // ── acceptedStatusCodes ───────────────────────────────────────────────────

  it('should return UP when status code is in acceptedStatusCodes', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 201;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig({ acceptedStatusCodes: [200, 201] }));

    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(201);
    expect(result.errorMessage).toBeNull();
  });

  it('should return DOWN when status code not in acceptedStatusCodes', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 301;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      const req = new EventEmitter() as any;
      req.on = req.on.bind(req);
      return req;
    });

    const result = await checker.check(createConfig({ acceptedStatusCodes: [200, 201] }));

    expect(result.status).toBe('down');
    expect(result.statusCode).toBe(301);
    expect(result.errorMessage).toContain('200');
    expect(result.errorMessage).toContain('201');
  });

  // ── slowThresholdMs per monitor ───────────────────────────────────────────

  it('should return DEGRADED using per-monitor slowThresholdMs', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      // Delay the response callback by 50ms so elapsed time exceeds threshold
      setTimeout(() => {
        cb(mockResponse);
        mockResponse.emit('end');
      }, 50);
      const req = new EventEmitter() as any;
      req.on = req.on.bind(req);
      return req;
    });

    const result = await checker.check(createConfig({ slowThresholdMs: 1 }));

    expect(result.status).toBe('degraded');
  });

  it('should return UP when response is within per-monitor slowThresholdMs', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    mockResponse.socket = { remoteAddress: '1.2.3.4' };

    vi.spyOn(http, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(createConfig({ slowThresholdMs: 10000 }));

    expect(result.status).toBe('up');
  });

  // ── checkSsl flag ─────────────────────────────────────────────────────────

  it('should skip TLS extraction when checkSsl is false', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    const socket = Object.create(TLSSocket.prototype) as TLSSocket & { remoteAddress?: string };
    Object.defineProperty(socket, 'remoteAddress', { get: () => '8.8.8.8' });
    (socket as any).getPeerCertificate = vi.fn().mockReturnValue({
      valid_to: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toUTCString(),
    });
    mockResponse.socket = socket;

    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(
      createConfig({
        protocol: 'https',
        url: 'https://example.com',
        checkSsl: false,
      }),
    );

    expect((socket as any).getPeerCertificate).not.toHaveBeenCalled();
    expect(result.tlsCertificateDaysRemaining).toBeNull();
    expect(result.sslExpiryWarning).toBe(false);
  });

  // ── ssl_expiry_warning ────────────────────────────────────────────────────

  it('should set sslExpiryWarning=true when cert expires within sslExpiryReminderDays', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    const socket = Object.create(TLSSocket.prototype) as TLSSocket & { remoteAddress?: string };
    Object.defineProperty(socket, 'remoteAddress', { get: () => '8.8.8.8' });
    // Cert expires in 15 days
    (socket as any).getPeerCertificate = vi.fn().mockReturnValue({
      valid_to: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toUTCString(),
    });
    mockResponse.socket = socket;

    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(
      createConfig({
        protocol: 'https',
        url: 'https://example.com',
        checkSsl: true,
        sslExpiryReminderDays: 30,
      }),
    );

    expect(result.status).toBe('up');
    expect(result.sslExpiryWarning).toBe(true);
    expect(result.tlsCertificateDaysRemaining).toBeGreaterThan(0);
  });

  it('should set sslExpiryWarning=false when cert is not close to expiry', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    const socket = Object.create(TLSSocket.prototype) as TLSSocket & { remoteAddress?: string };
    Object.defineProperty(socket, 'remoteAddress', { get: () => '8.8.8.8' });
    // Cert expires in 90 days
    (socket as any).getPeerCertificate = vi.fn().mockReturnValue({
      valid_to: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString(),
    });
    mockResponse.socket = socket;

    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(
      createConfig({
        protocol: 'https',
        url: 'https://example.com',
        checkSsl: true,
        sslExpiryReminderDays: 30,
      }),
    );

    expect(result.sslExpiryWarning).toBe(false);
  });

  it('should not set sslExpiryWarning when sslExpiryReminderDays is not configured', async () => {
    const mockResponse = new PassThrough() as any;
    mockResponse.statusCode = 200;
    const socket = Object.create(TLSSocket.prototype) as TLSSocket & { remoteAddress?: string };
    Object.defineProperty(socket, 'remoteAddress', { get: () => '8.8.8.8' });
    // Cert expires in 5 days — but no reminder days set
    (socket as any).getPeerCertificate = vi.fn().mockReturnValue({
      valid_to: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toUTCString(),
    });
    mockResponse.socket = socket;

    vi.spyOn(https, 'get').mockImplementation((_url: any, _opts: any, cb: any) => {
      process.nextTick(() => cb(mockResponse));
      process.nextTick(() => mockResponse.emit('end'));
      const req = new EventEmitter() as any;
      return req;
    });

    const result = await checker.check(
      createConfig({
        protocol: 'https',
        url: 'https://example.com',
        checkSsl: true,
        // sslExpiryReminderDays not set
      }),
    );

    expect(result.sslExpiryWarning).toBe(false);
  });
});
