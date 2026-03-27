import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HealthServer } from './health.server';
import { HealthService } from './health.service';
import pino from 'pino';

describe('HealthServer', () => {
  let healthServer: HealthServer;
  let healthService: HealthService;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    const messageBroker = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      subscribe: vi.fn(),
      publish: vi.fn(),
    } as any;


    healthService = new HealthService(messageBroker);
    healthServer = new HealthServer(3001, healthService, logger);
  });

  afterEach(async () => {
    try {
      await healthServer.stop();
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe('start', () => {
    it('should start the server and listen on the configured port', async () => {
      await healthServer.start();

      const response = await fetch('http://localhost:3001/health');
      expect(response.status).toBe(200);
    });

    it('should reject when port is already in use', async () => {
      await healthServer.start();

      const server2 = new HealthServer(3001, healthService, logger);
      await expect(server2.start()).rejects.toThrow();
    });
  });

  describe('GET /health', () => {
    beforeEach(async () => {
      (healthService as any).messageBroker.isConnected = vi.fn().mockResolvedValue(true);
      (healthService as any).storageProvider.healthCheck = vi.fn().mockResolvedValue(undefined);
      await healthServer.start();
    });

    it('should return 200 when healthy', async () => {
      const response = await fetch('http://localhost:3001/health');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('should return health status JSON', async () => {
      const response = await fetch('http://localhost:3001/health');
      const body = (await response.json()) as Record<string, unknown>;

      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('checks');
      expect(body).toHaveProperty('metrics');
    });

    it('should return 503 when degraded', async () => {
      (healthService as any).messageBroker.isConnected = vi.fn().mockResolvedValue(false);

      const response = await fetch('http://localhost:3001/health');

      expect(response.status).toBe(503);
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe('degraded');
    });

    it('should include CORS headers', async () => {
      const response = await fetch('http://localhost:3001/health');

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should handle errors thrown by healthService.check()', async () => {
      const mockCheck = vi.spyOn(healthService, 'check');
      mockCheck.mockRejectedValueOnce(new Error('Check failed'));

      const response = await fetch('http://localhost:3001/health');

      expect(response.status).toBe(500);
      const body = (await response.json()) as { status: string; error: string };
      expect(body.status).toBe('unhealthy');
      expect(body.error).toBe('Check failed');
    });
  });

  describe('GET /ready', () => {
    beforeEach(async () => {
      (healthService as any).messageBroker.isConnected = vi.fn().mockResolvedValue(true);
      (healthService as any).storageProvider.healthCheck = vi.fn().mockResolvedValue(undefined);
      await healthServer.start();
    });

    it('should return 200 when ready', async () => {
      const response = await fetch('http://localhost:3001/ready');

      expect(response.status).toBe(200);
      const body = (await response.json()) as { ready: boolean };
      expect(body.ready).toBe(true);
    });

    it('should return 503 when not ready', async () => {
      (healthService as any).messageBroker.isConnected = vi.fn().mockResolvedValue(false);

      const response = await fetch('http://localhost:3001/ready');

      expect(response.status).toBe(503);
      const body = (await response.json()) as { ready: boolean };
      expect(body.ready).toBe(false);
    });
  });

  describe('Unknown Routes', () => {
    beforeEach(async () => {
      await healthServer.start();
    });

    it('should return 404 for unknown paths', async () => {
      const response = await fetch('http://localhost:3001/unknown');

      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe('Not found');
    });

    it('should return 404 for POST requests', async () => {
      const response = await fetch('http://localhost:3001/health', { method: 'POST' });

      expect(response.status).toBe(404);
    });

    it('should return 404 for PUT requests', async () => {
      const response = await fetch('http://localhost:3001/health', { method: 'PUT' });

      expect(response.status).toBe(404);
    });
  });

  describe('stop', () => {
    it('should close the server', async () => {
      await healthServer.start();
      await healthServer.stop();

      const response = await fetch('http://localhost:3001/health').catch(() => null);
      expect(response).toBeNull();
    });

    it('should handle stop when server is not started', async () => {
      await expect(healthServer.stop()).resolves.not.toThrow();
    });
  });
});
