import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpChecker } from './http.checker';
import { MonitorConfig } from '../../../domain/value-objects/monitor-config';
import http from 'node:http';
import https from 'node:https';
import { TLSSocket } from 'node:tls';
import { EventEmitter, PassThrough } from 'node:stream';

function createConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    monitorId: 1,
    siteId: 10,
    workspaceId: 100,
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
    expect(result.errorMessage).toContain('Expected status 200');
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

    const result = await checker.check(createConfig({
      protocol: 'https',
      url: 'https://example.com',
    }));

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
      process.nextTick(() => mockReq.emit('error', new Error('ECONNRESET: Connection reset by peer')));
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
    dateNowSpy
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(120000);

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

    const result = await checker.check(createConfig({ protocol: 'https', url: 'https://example.com' }));

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

    const result = await checker.check(createConfig({ protocol: 'https', url: 'https://example.com' }));

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
});
