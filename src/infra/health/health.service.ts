import { IMessageBroker } from '../../domain/interfaces/message-broker.interface';
import { IStorageProvider } from '../../domain/interfaces/storage.interface';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    rabbitmq: {
      connected: boolean;
      error?: string;
    };
  };
  metrics: {
    lastJobProcessedAt?: string;
    jobsProcessed: number;
  };
}

export class HealthService {
  private startTime = Date.now();
  private jobsProcessed = 0;
  private lastJobProcessedAt?: Date;

  constructor(
    private messageBroker: IMessageBroker,
  ) { }

  async check(): Promise<HealthStatus> {
    const rabbitmqCheck = await this.checkRabbitMQ();

    const isHealthy = rabbitmqCheck.connected;
    const status = isHealthy ? 'healthy' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      checks: {
        rabbitmq: rabbitmqCheck,
      },
      metrics: {
        lastJobProcessedAt: this.lastJobProcessedAt?.toISOString(),
        jobsProcessed: this.jobsProcessed,
      },
    };
  }

  recordJobProcessed(): void {
    this.jobsProcessed++;
    this.lastJobProcessedAt = new Date();
  }

  private async checkRabbitMQ(): Promise<{ connected: boolean; error?: string }> {
    try {
      // Check if the broker has an isConnected method or property
      if (typeof (this.messageBroker as any).isConnected === 'function') {
        const connected = await (this.messageBroker as any).isConnected();
        return { connected };
      }
      // Fallback: assume connected if no error is thrown
      return { connected: true };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
