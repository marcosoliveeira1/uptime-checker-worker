import { describe, it, expect, vi, afterEach } from 'vitest';
import { DnsChecker } from './dns.checker';
import { MonitorConfig } from '../../../domain/value-objects/monitor-config';
import dns from 'node:dns/promises';

function createConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    monitorId: 1,
    siteId: 10,
    workspaceId: 100,
    url: 'http://example.com',
    protocol: 'dns',
    checkIntervalSeconds: 60,
    timeoutSeconds: 5,
    ...overrides,
  };
}

describe('DnsChecker', () => {
  const checker = new DnsChecker();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return UP on successful resolution', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);

    const result = await checker.check(createConfig());

    expect(result.status).toBe('up');
    expect(result.ipAddress).toBe('93.184.216.34');
    expect(result.errorMessage).toBeNull();
  });

  it('should return DOWN on ENOTFOUND', async () => {
    vi.spyOn(dns, 'resolve4').mockRejectedValue(new Error('queryA ENOTFOUND nonexistent.example'));

    const result = await checker.check(createConfig({ url: 'http://nonexistent.example' }));

    expect(result.status).toBe('down');
    expect(result.errorMessage).toContain('ENOTFOUND');
  });

  it('should return DOWN on resolution failure', async () => {
    vi.spyOn(dns, 'resolve4').mockRejectedValue(new Error('DNS resolution failed'));

    const result = await checker.check(createConfig());

    expect(result.status).toBe('down');
    expect(result.errorMessage).toBe('DNS resolution failed');
  });

  it('should return UP with multiple IPs (uses first)', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['1.2.3.4', '5.6.7.8', '9.10.11.12']);

    const result = await checker.check(createConfig());

    expect(result.status).toBe('up');
    expect(result.ipAddress).toBe('1.2.3.4');
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should measure resolution time', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);

    const result = await checker.check(createConfig());

    expect(result.responseTimeMs).toBeLessThan(5000);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should have null values for irrelevant fields', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['1.2.3.4']);

    const result = await checker.check(createConfig());

    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toBeNull();
    expect(result.tlsCertificateDaysRemaining).toBeNull();
  });

  it('should handle empty response array gracefully', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue([]);

    const result = await checker.check(createConfig());

    expect(result.status).toBe('up');
    expect(result.ipAddress).toBeNull();
  });

  it('should return timeout message when abort signal was triggered', async () => {
    vi.useFakeTimers();
    vi.spyOn(dns, 'resolve4').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('DNS timeout simulated')), 1100);
        }) as any,
    );

    const resultPromise = checker.check(createConfig({ timeoutSeconds: 1 }));
    await vi.advanceTimersByTimeAsync(1100);
    const result = await resultPromise;

    expect(result.status).toBe('down');
    expect(result.errorMessage).toBe('Timeout after 1000ms');
    vi.useRealTimers();
  });

  it('should return generic message for non-Error failures', async () => {
    vi.spyOn(dns, 'resolve4').mockRejectedValue('not-an-error');

    const result = await checker.check(createConfig());

    expect(result.status).toBe('down');
    expect(result.errorMessage).toBe('DNS resolution failed');
  });
});
