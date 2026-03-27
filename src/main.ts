import { existsSync, mkdirSync } from 'fs';
import { env } from './infra/config/env';
import { createServiceLogger } from './infra/config/logger';
import { RabbitMQAdapter } from './infra/adapters/rabbitmq.adapter';
import { HealthService } from './infra/health/health.service';
import { HealthServer } from './infra/health/health.server';

const log = createServiceLogger('bootstrap');

async function bootstrap() {
  log.info('Starting SiteOne Crawler WORKER...');
  log.info({ maxConcurrency: env.MAX_CONCURRENT_JOBS }, 'Worker configuration');

  // 1. Setup Environment
  if (!existsSync(env.CRAWLER_PATH)) {
    log.error({ path: env.CRAWLER_PATH }, 'Crawler binary missing');
    process.exit(1);
  }
  if (!existsSync(env.TMP_DIR)) {
    mkdirSync(env.TMP_DIR, { recursive: true });
  }

  const rabbitMQAdapter = new RabbitMQAdapter(
    env.RABBITMQ_URL,
    env.MAX_CONCURRENT_JOBS
  );

  // 3b. Initialize Health Service
  const healthService = new HealthService(rabbitMQAdapter);
  const healthServer = new HealthServer(3000, healthService, log);

  // 4. Start Connections
  try {
    log.info('Connecting to services');
    log.info({ minioInternal: env.MINIO_ENDPOINT, minioPublic: env.MINIO_PUBLIC_ENDPOINT || env.MINIO_ENDPOINT }, 'MinIO endpoints');

    await rabbitMQAdapter.connect();

    // 4b. Start Health Server
    await healthServer.start();

    // 5. Start Consuming
    await rabbitMQAdapter.subscribe('crawler.jobs.pending', async (msg) => {
      healthService.recordJobProcessed();
    });

    log.info('Worker is running and waiting for jobs');
  } catch (error) {
    log.error(error, 'Bootstrap failed');
    process.exit(1);
  }

  // 6. Graceful Shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}. Shutting down...`);

    // Close health server
    await healthServer.stop();

    // Close RabbitMQ connection
    await rabbitMQAdapter.disconnect();

    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap();