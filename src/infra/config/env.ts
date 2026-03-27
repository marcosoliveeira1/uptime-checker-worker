import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Crawler Configuration
  CRAWLER_PATH: z.string().min(1, "Path to crawler binary is required"),
  TMP_DIR: z.string().default('./tmp'),
  MAX_CONCURRENT_JOBS: z.coerce.number().default(2).describe('Limit concurrent crawler processes'),

  // RabbitMQ
  RABBITMQ_URL: z.string().url(),

  // MinIO / S3
  MINIO_ENDPOINT: z.string().url(),
  // ✅ New: Optional public endpoint for presigned URLs
  MINIO_PUBLIC_ENDPOINT: z.string().url().optional(),
  MINIO_REGION: z.string().default('us-east-1'),
  MINIO_BUCKET: z.string().min(1),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_USE_SSL: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
});

// Validate process.env
const _env = envSchema.safeParse(process.env);

if (process.env.NODE_ENV !== 'production') {
  console.log('Validating environment variables...');
}

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;