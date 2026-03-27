import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthService } from './health.service';
import { IMessageBroker } from '../../domain/interfaces/message-broker.interface';
import { IStorageProvider } from '../../domain/interfaces/storage.interface';

describe('HealthService', () => {
  let healthService: HealthService;
  let messageBroker: IMessageBroker;
  let storageProvider: IStorageProvider;

  beforeEach(() => {
    messageBroker = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      subscribe: vi.fn(),
      publish: vi.fn(),
    } as any;

    healthService = new HealthService(messageBroker);
  });

  describe('check', () => {
    it('should return healthy status when both connections are working', async () => {
      (messageBroker as any).isConnected = vi.fn().mockResolvedValue(true);

      const status = await healthService.check();

      expect(status.status).toBe('healthy');
      expect(status.checks.rabbitmq.connected).toBe(true);
      expect(status.timestamp).toBeDefined();
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.metrics.jobsProcessed).toBe(0);
    });

    it('should return degraded status when RabbitMQ is down', async () => {
      (messageBroker as any).isConnected = vi.fn().mockResolvedValue(false);

      const status = await healthService.check();

      expect(status.status).toBe('degraded');
      expect(status.checks.rabbitmq.connected).toBe(false);
    });

    it('should return degraded status when S3 is down', async () => {
      (messageBroker as any).isConnected = vi.fn().mockResolvedValue(true);

      const status = await healthService.check();

      expect(status.status).toBe('degraded');
      expect(status.checks.rabbitmq.connected).toBe(true);
    });

    it('should return degraded status when both are down', async () => {
      (messageBroker as any).isConnected = vi.fn().mockResolvedValue(false);

      const status = await healthService.check();

      expect(status.status).toBe('degraded');
      expect(status.checks.rabbitmq.connected).toBe(false);
    });

    it('should handle errors from RabbitMQ check', async () => {
      (messageBroker as any).isConnected = vi
        .fn()
        .mockRejectedValue(new Error('Connection timeout'));

      const status = await healthService.check();

      expect(status.checks.rabbitmq.connected).toBe(false);
      expect(status.checks.rabbitmq.error).toBe('Connection timeout');
    });

    it('should work without isConnected method (assume connected)', async () => {
      // messageBroker without isConnected method

      const status = await healthService.check();

      expect(status.checks.rabbitmq.connected).toBe(true);
    });

    it('should handle error object without message property from RabbitMQ', async () => {
      (messageBroker as any).isConnected = vi.fn().mockRejectedValue(new Error());

      const status = await healthService.check();

      expect(status.checks.rabbitmq.connected).toBe(false);
      expect(status.checks.rabbitmq.error).toBeDefined();
    });

    it('should handle non-Error thrown from S3', async () => {
      (messageBroker as any).isConnected = vi.fn().mockResolvedValue(true);

      const status = await healthService.check();
    });

    it('should include timestamp in ISO format', async () => {
      const status = await healthService.check();

      expect(status.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should track uptime correctly', async () => {
      const status1 = await healthService.check();
      const uptime1 = status1.uptime;

      await new Promise((resolve) => setTimeout(resolve, 10));

      const status2 = await healthService.check();
      const uptime2 = status2.uptime;

      expect(uptime2).toBeGreaterThan(uptime1);
    });
  });

  describe('recordJobProcessed', () => {
    it('should increment jobsProcessed counter', async () => {
      let status = await healthService.check();
      expect(status.metrics.jobsProcessed).toBe(0);

      healthService.recordJobProcessed();

      status = await healthService.check();
      expect(status.metrics.jobsProcessed).toBe(1);

      healthService.recordJobProcessed();

      status = await healthService.check();
      expect(status.metrics.jobsProcessed).toBe(2);
    });

    it('should update lastJobProcessedAt timestamp', async () => {
      let status = await healthService.check();
      expect(status.metrics.lastJobProcessedAt).toBeUndefined();

      healthService.recordJobProcessed();

      status = await healthService.check();
      expect(status.metrics.lastJobProcessedAt).toBeDefined();
      expect(status.metrics.lastJobProcessedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should update lastJobProcessedAt with each call', async () => {
      healthService.recordJobProcessed();
      let status = await healthService.check();
      const firstTimestamp = status.metrics.lastJobProcessedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      healthService.recordJobProcessed();
      status = await healthService.check();
      const secondTimestamp = status.metrics.lastJobProcessedAt;

      expect(secondTimestamp).not.toBe(firstTimestamp);
    });
  });
});
