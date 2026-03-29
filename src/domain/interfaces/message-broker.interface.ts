export interface IMessageBroker {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    publish(exchange: string, routingKey: string, message: unknown): Promise<void>;
    subscribe(
        queue: string,
        handler: (message: unknown) => Promise<void>,
    ): Promise<void>;
    ack(message: unknown): void;
    nack(message: unknown, requeue?: boolean): void;
}
