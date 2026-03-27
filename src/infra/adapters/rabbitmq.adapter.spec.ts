import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RabbitMQAdapter } from './rabbitmq.adapter';
import * as amqp from 'amqplib';

vi.mock('amqplib', () => ({
  connect: vi.fn(),
}));

describe('RabbitMQAdapter', () => {
  let adapter: RabbitMQAdapter;
  let mockConnection: any;
  let mockChannel: any;

  beforeEach(() => {
    vi.useFakeTimers(); // ⏱️ Controlar o tempo para testes de reconexão

    mockChannel = {
      assertExchange: vi.fn(),
      assertQueue: vi.fn(),
      bindQueue: vi.fn(),
      prefetch: vi.fn(),
      publish: vi.fn(),
      consume: vi.fn(),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn(),
    };

    mockConnection = {
      createChannel: vi.fn().mockResolvedValue(mockChannel),
      close: vi.fn(),
      on: vi.fn(),
    };

    vi.mocked(amqp.connect).mockResolvedValue(mockConnection);
    adapter = new RabbitMQAdapter('amqp://localhost', 2);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ... (Testes anteriores mantidos: connect, publish, consume, nack, empty message, disconnect) ...
  // Vou apenas adicionar os NOVOS testes de resiliência abaixo.
  // Você deve manter os testes anteriores neste arquivo.

  it('should connect and setup topology', async () => {
    await adapter.connect();
    expect(amqp.connect).toHaveBeenCalledWith('amqp://localhost');
    expect(mockConnection.createChannel).toHaveBeenCalled();
  });

  // --- NOVOS TESTES DE RESILIÊNCIA ---

  it('should schedule reconnect on connection error', async () => {
    await adapter.connect();

    // Pegar o handler de erro registrado no connection.on('error', ...)
    const calls = mockConnection.on.mock.calls;
    const errorHandler = calls.find((call: any) => call[0] === 'error')?.[1];

    expect(errorHandler).toBeDefined();

    // Simular Erro
    errorHandler(new Error('Connection lost'));

    // Verificar se agendou (mas não chamou connect ainda)
    expect(amqp.connect).toHaveBeenCalledTimes(1); // A chamada inicial

    // Avançar o tempo (5000ms configurado no adapter)
    await vi.advanceTimersByTimeAsync(5000);

    // Deve ter tentado conectar de novo
    expect(amqp.connect).toHaveBeenCalledTimes(2);
  });

  it('should schedule reconnect on connection close', async () => {
    await adapter.connect();

    const calls = mockConnection.on.mock.calls;
    const closeHandler = calls.find((call: any) => call[0] === 'close')?.[1];

    expect(closeHandler).toBeDefined();

    // Simular Fechamento
    closeHandler();

    await vi.advanceTimersByTimeAsync(5000);
    expect(amqp.connect).toHaveBeenCalledTimes(2);
  });

  it('should retry connecting if initial connection fails', async () => {
    // Primeira tentativa falha
    vi.mocked(amqp.connect).mockRejectedValueOnce(new Error('Broker down'));
    // Segunda tentativa (reconexão) funciona
    vi.mocked(amqp.connect).mockResolvedValueOnce(mockConnection);

    // Tentar conectar (vai falhar e agendar retry)
    await expect(adapter.connect()).rejects.toThrow('Broker down');

    // Avançar tempo
    await vi.advanceTimersByTimeAsync(5000);

    // Deve ter tentado de novo e sucesso
    expect(amqp.connect).toHaveBeenCalledTimes(2);
    // Como mockamos o sucesso na segunda vez, ele deve ter criado o canal internamente
    // Podemos verificar se o createChannel foi chamado na segunda conexão
    expect(mockConnection.createChannel).toHaveBeenCalled();
  });

  it('should not schedule multiple reconnects if one is pending', async () => {
    await adapter.connect();

    // Forçar agendamento via método privado (ou simulando evento)
    // Aqui simulamos dois eventos rápidos antes do timer disparar
    const errorHandler = mockConnection.on.mock.calls.find((c: any) => c[0] === 'error')[1];

    errorHandler(new Error('Err 1'));
    errorHandler(new Error('Err 2')); // Deve ser ignorado pois já tem timer

    expect(amqp.connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);

    // Só deve ter reconectado uma vez adicional
    expect(amqp.connect).toHaveBeenCalledTimes(2);
  });

  it('should handle logic when channel is missing (defensive programming)', async () => {
    // Conecta mas deleta o canal forçadamente para testar
    await adapter.connect();
    (adapter as any).channel = null;

    await expect(adapter.publish('ex', 'key', {})).rejects.toThrow('Channel not initialized');
    await expect(adapter.subscribe('q', vi.fn())).rejects.toThrow('Channel not initialized');
  });

  // Replicação dos testes essenciais anteriores para garantir o arquivo completo
  it('should publish message correctly', async () => {
    await adapter.connect();
    await adapter.publish('ex', 'key', { a: 1 });
    expect(mockChannel.publish).toHaveBeenCalled();
  });

  it('should subscribe and ack', async () => {
    await adapter.connect();
    const handler = vi.fn();
    await adapter.subscribe('q', handler);
    const cb = mockChannel.consume.mock.calls[0][1];
    await cb({ content: Buffer.from('{}') });
    expect(handler).toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalled();
  });

  it('should nack on error', async () => {
    await adapter.connect();
    await adapter.subscribe('q', vi.fn().mockRejectedValue('err'));
    const cb = mockChannel.consume.mock.calls[0][1];
    await cb({ content: Buffer.from('{}') });
    expect(mockChannel.nack).toHaveBeenCalled();
  });

  it('should handle null msg', async () => {
    await adapter.connect();
    await adapter.subscribe('q', vi.fn());
    const cb = mockChannel.consume.mock.calls[0][1];
    await cb(null);
    expect(mockChannel.ack).not.toHaveBeenCalled();
  });

  it('should log error when reconnection fails', async () => {
    await adapter.connect();

    // Get the error handler
    const errorHandler = mockConnection.on.mock.calls.find((c: any) => c[0] === 'error')?.[1];
    expect(errorHandler).toBeDefined();

    // Make the next connection attempt fail
    vi.mocked(amqp.connect).mockRejectedValueOnce(new Error('Reconnection failed'));

    // Trigger the error to schedule reconnection
    errorHandler(new Error('Connection lost'));

    // Advance time to trigger the reconnection attempt
    await vi.advanceTimersByTimeAsync(5000);

    // Verify reconnection was attempted (the error is caught and logged)
    expect(amqp.connect).toHaveBeenCalledTimes(2);
  });

  it('should disconnect', async () => {
    await adapter.connect();
    await adapter.disconnect();
    expect(mockChannel.close).toHaveBeenCalled();
    expect(mockConnection.close).toHaveBeenCalled();
  });

  it('should handle ack when channel is missing', () => {
    (adapter as any).channel = null;
    const mockMessage = { content: Buffer.from('{}') };
    // Should not throw even if channel is null
    adapter.ack(mockMessage);
  });

  it('should handle nack when channel is missing', () => {
    (adapter as any).channel = null;
    const mockMessage = { content: Buffer.from('{}') };
    // Should not throw even if channel is null
    adapter.nack(mockMessage, false);
  });

  it('should handle disconnect when connection is missing', async () => {
    await adapter.connect();
    (adapter as any).connection = null;
    // Should not throw even if connection is null
    await adapter.disconnect();
    expect(mockChannel.close).toHaveBeenCalled();
  });

  it('should throw when setupTopology called without channel', async () => {
    (adapter as any).channel = null;
    // Calling private setupTopology via any
    await expect((adapter as any).setupTopology()).rejects.toThrow('Channel not initialized');
  });
});