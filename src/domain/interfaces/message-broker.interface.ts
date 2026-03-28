export interface IMessageBroker {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    publish(exchange: string, routingKey: string, message: any): Promise<void>;
    subscribe(queue: string, handler: (message: any) => Promise<void>): Promise<void>;
    ack(message: any): void;
    nack(message: any, requeue?: boolean): void;
}
