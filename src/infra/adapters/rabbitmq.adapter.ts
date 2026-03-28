import * as amqp from 'amqplib';
import { Channel, ConsumeMessage } from 'amqplib';
import { IMessageBroker } from '../../domain/interfaces/message-broker.interface';
import { createAdapterLogger } from '../config/logger';

const log = createAdapterLogger('rabbitmq');

const MAX_BUFFER_SIZE = 1000;

interface BufferedMessage {
  exchange: string;
  routingKey: string;
  content: Buffer;
}

export interface RawMessage {
  content: any;
  routingKey: string;
}

export class RabbitMQAdapter implements IMessageBroker {
  private connection: amqp.ChannelModel | null = null;
  private channel: Channel | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connected = false;
  private buffer: BufferedMessage[] = [];

  constructor(
    private readonly url: string,
    private readonly prefetchCount: number = 10,
  ) {}

  async connect(): Promise<void> {
    try {
      log.info({ url: this.url }, 'Connecting to RabbitMQ');
      this.connection = await amqp.connect(this.url);
      this.channel = await this.connection.createChannel();

      await this.channel.prefetch(this.prefetchCount);
      log.info({ prefetch: this.prefetchCount }, 'RabbitMQ prefetch set');

      await this.setupTopology();

      this.connected = true;

      // Drain buffer on reconnect
      await this.drainBuffer();

      this.connection.on('error', (err) => {
        log.error(err, 'RabbitMQ connection error');
        this.connected = false;
        this.scheduleReconnect();
      });

      this.connection.on('close', () => {
        log.warn('RabbitMQ connection closed');
        this.connected = false;
        this.scheduleReconnect();
      });

      log.info('Connected to RabbitMQ');
    } catch (error) {
      log.error(error, 'Failed to connect to RabbitMQ');
      this.connected = false;
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
    await this.channel.assertExchange('uptime.commands', 'topic', { durable: true });
    await this.channel.assertExchange('uptime.results', 'topic', { durable: true });

    // Queue for processing commands
    await this.channel.assertQueue('uptime.commands.pending', {
      durable: true,
    });

    // Dead Letter Queue
    await this.channel.assertQueue('uptime.commands.dlq', { durable: true });

    // Bindings
    await this.channel.bindQueue('uptime.commands.pending', 'uptime.commands', 'site.add');
    await this.channel.bindQueue('uptime.commands.pending', 'uptime.commands', 'site.update');
    await this.channel.bindQueue('uptime.commands.pending', 'uptime.commands', 'site.remove');
  }

  async publish(exchange: string, routingKey: string, message: any): Promise<void> {
    const content = Buffer.from(JSON.stringify(message));

    if (!this.channel || !this.connected) {
      // Buffer the message for later
      if (this.buffer.length < MAX_BUFFER_SIZE) {
        this.buffer.push({ exchange, routingKey, content });
        log.warn(
          { exchange, routingKey, bufferSize: this.buffer.length },
          'Message buffered (disconnected)',
        );
      } else {
        log.error({ exchange, routingKey }, 'Buffer full, message dropped');
      }
      return;
    }

    this.channel.publish(exchange, routingKey, content, {
      persistent: true,
      contentType: 'application/json',
      timestamp: Date.now(),
    });
  }

  private async drainBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    log.info({ count: this.buffer.length }, 'Draining message buffer');
    const messages = [...this.buffer];
    this.buffer = [];

    for (const msg of messages) {
      if (!this.channel || !this.connected) {
        this.buffer.push(msg);
        break;
      }
      this.channel.publish(msg.exchange, msg.routingKey, msg.content, {
        persistent: true,
        contentType: 'application/json',
        timestamp: Date.now(),
      });
    }
  }

  async subscribeWithRouting(
    queue: string,
    handler: (message: RawMessage) => Promise<void>,
  ): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    await this.channel.consume(
      queue,
      async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
          const content = JSON.parse(msg.content.toString());
          const routingKey = msg.fields.routingKey;

          log.debug({ routingKey }, 'Received command');

          await handler({ content, routingKey });

          this.ack(msg);
        } catch (error) {
          log.error(error, 'Error processing command');
          this.nack(msg, false);
        }
      },
      { noAck: false },
    );

    log.info({ queue }, 'Subscribed to queue with routing');
  }

  async subscribe(queue: string, handler: (message: any) => Promise<void>): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    await this.channel.consume(
      queue,
      async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
          const content = JSON.parse(msg.content.toString());
          await handler(content);
          this.ack(msg);
        } catch (error) {
          log.error(error, 'Error processing message');
          this.nack(msg, false);
        }
      },
      { noAck: false },
    );

    log.info({ queue }, 'Subscribed to queue');
  }

  ack(message: any): void {
    if (this.channel) this.channel.ack(message);
  }

  nack(message: any, requeue: boolean = false): void {
    if (this.channel) this.channel.nack(message, false, requeue);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
  }
}
