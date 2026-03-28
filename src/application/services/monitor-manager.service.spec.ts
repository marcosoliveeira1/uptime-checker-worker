import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitorManager } from './monitor-manager.service';
import { IMonitorScheduler } from '../../domain/interfaces/monitor-scheduler.interface';
import { IMessageBroker } from '../../domain/interfaces/message-broker.interface';
import { CheckerFactory } from '../../infra/adapters/checkers/checker.factory';
import { WideEventEmitter } from '../../infra/observability/wide-event.emitter';
import {
  AddSiteCommand,
  RemoveSiteCommand,
  UpdateSiteCommand,
} from '../../domain/events/monitor-command.event';
import { IUptimeChecker } from '../../domain/interfaces/uptime-checker.interface';

function createMockScheduler(): IMonitorScheduler {
  return {
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    getActiveCount: vi.fn().mockReturnValue(0),
    getActiveChecks: vi.fn().mockReturnValue(0),
  };
}

function createMockBroker(): IMessageBroker {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn(),
    nack: vi.fn(),
  };
}

function createMockCheckerFactory(): CheckerFactory {
  const mockChecker: IUptimeChecker = {
    check: vi.fn().mockResolvedValue({
      status: 'up',
      responseTimeMs: 100,
      statusCode: 200,
      errorMessage: null,
      ipAddress: '1.2.3.4',
      tlsCertificateDaysRemaining: 30,
      sslExpiryWarning: false,
    }),
  };

  return {
    getChecker: vi.fn().mockReturnValue(mockChecker),
  } as unknown as CheckerFactory;
}

function createMockWideEventEmitter(): WideEventEmitter {
  return {
    emit: vi.fn(),
  } as unknown as WideEventEmitter;
}

const addCommand: AddSiteCommand = {
  monitor_id: 'mon_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  site_id: 'site_01ARZ3NDEKTSV4RRFFQ69G5FB0',
  workspace_id: 'ws_01ARZ3NDEKTSV4RRFFQ69G5FB1',
  url: 'https://example.com',
  protocol: 'https',
  check_interval_seconds: 60,
  timeout_seconds: 30,
  idempotency_key: 'add-1-1234',
};

describe('MonitorManager', () => {
  let scheduler: IMonitorScheduler;
  let broker: IMessageBroker;
  let checkerFactory: CheckerFactory;
  let wideEventEmitter: WideEventEmitter;
  let manager: MonitorManager;

  beforeEach(() => {
    scheduler = createMockScheduler();
    broker = createMockBroker();
    checkerFactory = createMockCheckerFactory();
    wideEventEmitter = createMockWideEventEmitter();
    manager = new MonitorManager(scheduler, checkerFactory, broker, wideEventEmitter);
  });

  describe('addMonitor', () => {
    it('should register monitor and add to scheduler', () => {
      manager.addMonitor(addCommand);

      expect(scheduler.add).toHaveBeenCalledWith(
        'mon_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        60000,
        expect.any(Function),
      );
      expect(manager.getMonitorsActive()).toBe(1);
    });

    it('should treat duplicate add as update (idempotency)', () => {
      manager.addMonitor(addCommand);
      manager.addMonitor(addCommand);

      expect(scheduler.add).toHaveBeenCalledTimes(1);
      expect(scheduler.update).toHaveBeenCalledTimes(1);
      expect(manager.getMonitorsActive()).toBe(1);
    });
  });

  describe('updateMonitor', () => {
    it('should update config and scheduler', () => {
      manager.addMonitor(addCommand);

      const updateCommand: UpdateSiteCommand = {
        ...addCommand,
        check_interval_seconds: 30,
        idempotency_key: 'update-1-1234',
      };

      manager.updateMonitor(updateCommand);

      expect(scheduler.update).toHaveBeenCalledWith('mon_01ARZ3NDEKTSV4RRFFQ69G5FAV', 30000);
      expect(manager.getMonitorsActive()).toBe(1);
    });

    it('should add to scheduler if monitor does not exist', () => {
      const updateCommand: UpdateSiteCommand = {
        ...addCommand,
        idempotency_key: 'update-1-1234',
      };

      manager.updateMonitor(updateCommand);

      expect(scheduler.add).toHaveBeenCalledWith(
        'mon_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        60000,
        expect.any(Function),
      );
    });
  });

  describe('removeMonitor', () => {
    it('should remove from registry and scheduler', () => {
      manager.addMonitor(addCommand);

      const removeCommand: RemoveSiteCommand = {
        monitor_id: 'mon_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        idempotency_key: 'remove-1-1234',
      };

      manager.removeMonitor(removeCommand);

      expect(scheduler.remove).toHaveBeenCalledWith('mon_01ARZ3NDEKTSV4RRFFQ69G5FAV');
      expect(manager.getMonitorsActive()).toBe(0);
    });
  });

  describe('executeCheck', () => {
    it('should execute check and publish result', async () => {
      manager.addMonitor(addCommand);

      await manager.executeCheck('mon_01ARZ3NDEKTSV4RRFFQ69G5FAV');

      expect(checkerFactory.getChecker).toHaveBeenCalledWith('https');
      expect(broker.publish).toHaveBeenCalledWith(
        'uptime.results',
        'check.completed',
        expect.objectContaining({
          monitor_id: 'mon_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          site_id: 'site_01ARZ3NDEKTSV4RRFFQ69G5FB0',
          workspace_id: 'ws_01ARZ3NDEKTSV4RRFFQ69G5FB1',
          status: 'up',
          ssl_expiry_warning: false,
        }),
      );
      expect(wideEventEmitter.emit).toHaveBeenCalled();
    });

    it('should handle check errors gracefully', async () => {
      const failingChecker: IUptimeChecker = {
        check: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      (checkerFactory.getChecker as any).mockReturnValue(failingChecker);

      manager.addMonitor(addCommand);
      await manager.executeCheck('mon_01ARZ3NDEKTSV4RRFFQ69G5FAV');

      expect(broker.publish).toHaveBeenCalledWith(
        'uptime.results',
        'check.completed',
        expect.objectContaining({
          status: 'down',
          error_message: 'Network error',
        }),
      );
    });

    it('should handle non-Error throw values', async () => {
      const failingChecker: IUptimeChecker = {
        check: vi.fn().mockRejectedValue('string-failure'),
      };
      (checkerFactory.getChecker as any).mockReturnValue(failingChecker);

      manager.addMonitor(addCommand);
      await manager.executeCheck('mon_01ARZ3NDEKTSV4RRFFQ69G5FAV');

      expect(broker.publish).toHaveBeenCalledWith(
        'uptime.results',
        'check.completed',
        expect.objectContaining({
          status: 'down',
          error_message: 'Unknown error',
        }),
      );
    });

    it('should skip check for unknown monitor', async () => {
      await manager.executeCheck('mon_unknown');
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('should increment metrics', async () => {
      manager.addMonitor(addCommand);

      await manager.executeCheck('mon_01ARZ3NDEKTSV4RRFFQ69G5FAV');

      expect(manager.getChecksTotal()).toBe(1);
      expect(manager.getChecksFailed()).toBe(0);
    });

    it('should count failed checks', async () => {
      const failingChecker: IUptimeChecker = {
        check: vi.fn().mockResolvedValue({
          status: 'down',
          responseTimeMs: 100,
          statusCode: 500,
          errorMessage: 'Server error',
          ipAddress: null,
          tlsCertificateDaysRemaining: null,
        }),
      };
      (checkerFactory.getChecker as any).mockReturnValue(failingChecker);

      manager.addMonitor(addCommand);
      await manager.executeCheck('mon_01ARZ3NDEKTSV4RRFFQ69G5FAV');

      expect(manager.getChecksFailed()).toBe(1);
    });
  });

  describe('HealthMetricsProvider', () => {
    it('should return correct metrics', () => {
      expect(manager.getMonitorsActive()).toBe(0);
      expect(manager.getChecksTotal()).toBe(0);
      expect(manager.getChecksFailed()).toBe(0);
      expect(manager.getActiveChecks()).toBe(0);
    });

    it('should track isSchedulerRunning', () => {
      expect(manager.isSchedulerRunning()).toBe(true); // scheduler exists
    });
  });

  describe('Idempotency key generation', () => {
    it('should generate idempotency key based on monitorId and minute', async () => {
      manager.addMonitor(addCommand);

      await manager.executeCheck('mon_01ARZ3NDEKTSV4RRFFQ69G5FAV');

      expect(broker.publish).toHaveBeenCalledWith(
        'uptime.results',
        'check.completed',
        expect.objectContaining({
          idempotency_key: expect.stringMatching(/^mon_.+:\d+$/),
        }),
      );
    });
  });

  describe('Config conversion', () => {
    it('should convert command with all optional fields', async () => {
      const command: AddSiteCommand = {
        monitor_id: 'mon_02BRY4OFLUXV5SSGGG75H6GBW',
        site_id: 'site_02BRY4OFLUXV5SSGGG75H6GBX',
        workspace_id: 'ws_02BRY4OFLUXV5SSGGG75H6GBY',
        url: 'https://api.example.com',
        protocol: 'https',
        check_interval_seconds: 30,
        timeout_seconds: 10,
        expected_status_code: 201,
        keyword_check: 'success',
        idempotency_key: 'add-2-5678',
      };

      manager.addMonitor(command);

      expect(scheduler.add).toHaveBeenCalledWith(
        'mon_02BRY4OFLUXV5SSGGG75H6GBW',
        30000,
        expect.any(Function),
      );
      expect(manager.getMonitorsActive()).toBe(1);
    });
  });

  describe('Multiple monitors', () => {
    it('should manage multiple monitors independently', async () => {
      const cmd1 = {
        ...addCommand,
        monitor_id: 'mon_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        idempotency_key: 'add-1',
      };
      const cmd2 = {
        ...addCommand,
        monitor_id: 'mon_02BRY4OFLUXV5SSGGG75H6GBW',
        site_id: 'site_02BRY4OFLUXV5SSGGG75H6GBX',
        idempotency_key: 'add-2',
      };

      manager.addMonitor(cmd1);
      manager.addMonitor(cmd2);

      expect(manager.getMonitorsActive()).toBe(2);
      expect(scheduler.add).toHaveBeenCalledTimes(2);

      manager.removeMonitor({
        monitor_id: 'mon_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        idempotency_key: 'remove-1',
      });

      expect(manager.getMonitorsActive()).toBe(1);
      expect(scheduler.remove).toHaveBeenCalledWith('mon_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    });
  });
});
