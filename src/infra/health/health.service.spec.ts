import { describe, it, expect, vi } from 'vitest';
import { HealthService, HealthMetricsProvider } from './health.service';
import { RabbitMQAdapter } from '../adapters/rabbitmq.adapter';

function createMockBroker(connected = true): RabbitMQAdapter {
  return {
    isConnected: vi.fn().mockReturnValue(connected),
  } as unknown as RabbitMQAdapter;
}

function createMockMetrics(overrides: Partial<HealthMetricsProvider> = {}): HealthMetricsProvider {
  return {
    getMonitorsActive: vi.fn().mockReturnValue(10),
    getChecksTotal: vi.fn().mockReturnValue(500),
    getChecksFailed: vi.fn().mockReturnValue(5),
    getActiveChecks: vi.fn().mockReturnValue(3),
    isSchedulerRunning: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

describe('HealthService', () => {
  it('should return healthy when connected', async () => {
    const service = new HealthService(createMockBroker(true));
    service.setMetricsProvider(createMockMetrics());

    const status = await service.check();

    expect(status.status).toBe('healthy');
    expect(status.rabbitmq_connected).toBe(true);
    expect(status.monitors_active).toBe(10);
    expect(status.checks_total).toBe(500);
    expect(status.checks_failed).toBe(5);
    expect(status.active_checks).toBe(3);
    expect(status.scheduler_running).toBe(true);
  });

  it('should return degraded when disconnected', async () => {
    const service = new HealthService(createMockBroker(false));
    service.setMetricsProvider(createMockMetrics());

    const status = await service.check();

    expect(status.status).toBe('degraded');
    expect(status.rabbitmq_connected).toBe(false);
  });

  it('should return defaults without metrics provider', async () => {
    const service = new HealthService(createMockBroker(true));

    const status = await service.check();

    expect(status.monitors_active).toBe(0);
    expect(status.checks_total).toBe(0);
    expect(status.scheduler_running).toBe(false);
  });

  it('should report ready when connected and scheduler running', async () => {
    const service = new HealthService(createMockBroker(true));
    service.setMetricsProvider(createMockMetrics());

    expect(await service.isReady()).toBe(true);
  });

  it('should report not ready when disconnected', async () => {
    const service = new HealthService(createMockBroker(false));
    service.setMetricsProvider(createMockMetrics());

    expect(await service.isReady()).toBe(false);
  });

  it('should report not ready without metrics provider', async () => {
    const service = new HealthService(createMockBroker(true));

    expect(await service.isReady()).toBe(false);
  });

  it('should track uptime_seconds', async () => {
    const service = new HealthService(createMockBroker(true));
    const status = await service.check();

    expect(status.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});
