import * as amqp from 'amqplib';
import { Channel, Connection, ConsumeMessage } from 'amqplib';
import { IMessageBroker } from '../../domain/interfaces/message-broker.interface';
import { createAdapterLogger } from '../config/logger';

const log = createAdapterLogger('rabbitmq');

export class RabbitMQAdapter implements IMessageBroker {
  private connection: amqp.ChannelModel | null = null;
  private channel: Channel | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly prefetchCount: number
  ) { }

  async connect(): Promise<void> {
    try {
      log.info({ url: this.url }, 'Connecting to RabbitMQ');
      this.connection = await amqp.connect(this.url);
      this.channel = await this.connection.createChannel();

      // **Critical for Worker Pattern**: Limits concurrent processing
      await this.channel.prefetch(this.prefetchCount);
      log.info({ prefetch: this.prefetchCount }, 'RabbitMQ prefetch set');

      await this.setupTopology();

      this.connection.on('error', (err) => {
        log.error(err, 'RabbitMQ connection error');
        this.scheduleReconnect();
      });

      this.connection.on('close', () => {
        log.warn('RabbitMQ connection closed');
        this.scheduleReconnect();
      });

      log.info('Connected to RabbitMQ');
    } catch (error) {
      log.error(error, 'Failed to connect to RabbitMQ');
      this.scheduleReconnect();
      throw error;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        await this.connect();
      } catch (error) {
        log.error(error, 'Reconnection failed, will retry');
      }
    }, 5000);
  }

  private async setupTopology(): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    // Exchanges
    await this.channel.assertExchange('crawler.jobs', 'topic', { durable: true });
    await this.channel.assertExchange('crawler.results', 'topic', { durable: true });

    // Queue for processing
    await this.channel.assertQueue('crawler.jobs.pending', {
      durable: true,
      arguments: { 'x-message-ttl': 86400000 } // 24h
    });

    // Dead Letter Queue
    await this.channel.assertQueue('crawler.jobs.dlq', { durable: true });

    // Bindings
    await this.channel.bindQueue('crawler.jobs.pending', 'crawler.jobs', 'job.create');
  }

  async publish(exchange: string, routingKey: string, message: any): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    const content = Buffer.from(JSON.stringify(message));
    this.channel.publish(exchange, routingKey, content, {
      persistent: true,
      contentType: 'application/json',
      timestamp: Date.now(),
    });
  }

  async subscribe(queue: string, handler: (message: any) => Promise<void>): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    await this.channel.consume(
      queue,
      async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
          const content = JSON.parse(msg.content.toString());
          log.info({ jobId: content.jobId }, 'Received job');

          // Await handler allows prefetch to work correctly
          await handler(content);

          this.ack(msg);
          log.debug({ jobId: content.jobId }, 'Job acked');
        } catch (error) {
          log.error(error, 'Error processing job');
          // Requeue = false sends to DLQ (if configured) or drops it
          this.nack(msg, false);
        }
      },
      { noAck: false } // Manual Ack is mandatory for prefetch to work
    );

    log.info({ queue }, 'Subscribed to queue');
  }

  ack(message: any): void {
    if (this.channel) this.channel.ack(message);
  }

  nack(message: any, requeue: boolean = false): void {
    if (this.channel) this.channel.nack(message, false, requeue);
  }

  async disconnect(): Promise<void> {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
  }
}