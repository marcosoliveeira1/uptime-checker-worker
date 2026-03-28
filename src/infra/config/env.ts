import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // RabbitMQ
  RABBITMQ_URL: process.env.NODE_ENV === 'production' ? z.url() : z.url().optional(),

  // Scheduler
  MAX_CONCURRENT_CHECKS: z.coerce.number().default(50),
  TICK_INTERVAL_MS: z.coerce.number().default(1000),

  // Checker defaults
  DEFAULT_TIMEOUT_MS: z.coerce.number().default(30000),
  DEGRADED_THRESHOLD_MS: z.coerce.number().default(5000),

  // Health server
  HEALTH_PORT: z.coerce.number().default(3001),

  // Logging
  LOG_LEVEL: z.string().default('info'),
});

const _env = envSchema.safeParse(process.env);

if (process.env.NODE_ENV !== 'production') {
  console.log('Validating environment variables...');
}

if (!_env.success) {
  console.error('Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
