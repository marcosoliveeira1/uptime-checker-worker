import { v4 as uuidv4 } from 'uuid';
import { env } from './infra/config/env';
import { createServiceLogger } from './infra/config/logger';
import { RabbitMQAdapter } from './infra/adapters/rabbitmq.adapter';
import { CheckerFactory } from './infra/adapters/checkers/checker.factory';
import { TickScheduler } from './infra/scheduler/tick-scheduler';
import { MonitorManager } from './application/services/monitor-manager.service';
import { WideEventEmitter } from './infra/observability/wide-event.emitter';
import { HealthService } from './infra/health/health.service';
import { HealthServer } from './infra/health/health.server';

const log = createServiceLogger('bootstrap');

async function bootstrap() {
  log.info('Starting Uptime Checker Worker...');

  // 1. Initialize adapters
  const rabbitMQAdapter = new RabbitMQAdapter(env.RABBITMQ_URL!);
  const checkerFactory = new CheckerFactory();
  const scheduler = new TickScheduler(env.TICK_INTERVAL_MS, env.MAX_CONCURRENT_CHECKS);
  const wideEventEmitter = new WideEventEmitter();

  // 2. Initialize application service
  const monitorManager = new MonitorManager(
    scheduler,
    checkerFactory,
    rabbitMQAdapter,
    wideEventEmitter,
  );

  // 3. Initialize health
  const healthService = new HealthService(rabbitMQAdapter);
  healthService.setMetricsProvider(monitorManager);
  const healthServer = new HealthServer(env.HEALTH_PORT, healthService, log);

  try {
    // 4. Connect to RabbitMQ
    await rabbitMQAdapter.connect();

    // 5. Start health server
    await healthServer.start();

    // 6. Subscribe to commands with routing
    await rabbitMQAdapter.subscribeWithRouting('uptime.commands.pending', async (msg) => {
      switch (msg.routingKey) {
        case 'site.add':
          monitorManager.addMonitor(msg.content);
          break;
        case 'site.update':
          monitorManager.updateMonitor(msg.content);
          break;
        case 'site.remove':
          monitorManager.removeMonitor(msg.content);
          break;
        default:
          log.warn({ routingKey: msg.routingKey }, 'Unknown routing key');
      }
    });

    // 7. Start scheduler
    scheduler.start();

    // 8. Publish worker-started event (bootstrap sync)
    await rabbitMQAdapter.publish('uptime.results', 'worker.started', {
      started_at: new Date().toISOString(),
      instance_id: uuidv4(),
    });

    log.info({
      healthPort: env.HEALTH_PORT,
      maxConcurrentChecks: env.MAX_CONCURRENT_CHECKS,
      tickIntervalMs: env.TICK_INTERVAL_MS,
    }, 'Worker is running');
  } catch (error) {
    log.error(error, 'Bootstrap failed');
    process.exit(1);
  }

  // 9. Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}. Shutting down...`);

    // Stop scheduler (no new checks)
    scheduler.stop();

    // Wait for in-flight checks (max 10s)
    const maxWait = Date.now() + 10_000;
    while (scheduler.getActiveChecks() > 0 && Date.now() < maxWait) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (scheduler.getActiveChecks() > 0) {
      log.warn({ activeChecks: scheduler.getActiveChecks() }, 'Shutdown timeout, some checks still in-flight');
    }

    await healthServer.stop();
    await rabbitMQAdapter.disconnect();

    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap();
