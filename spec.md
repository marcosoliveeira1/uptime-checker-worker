# Uptime Checker Worker — Especificacao Tecnica

> **Servico:** `uptime-checker-worker`
> **Stack:** Node.js 24 + TypeScript (strict mode) + Hexagonal Architecture
> **Comunicacao:** RabbitMQ (amqplib)
> **Natureza:** Stateful (1 instancia) — mantém registry de monitors em memória
> **Referencia geral:** `../specs.md` secoes 2.0, 4.2, 5.2, 7.2, 7.3, 9.4, 10

---

## 1. Visao Geral

O `uptime-checker-worker` e o servico responsavel por executar checks de disponibilidade (uptime) nos sites monitorados pelo SiteWatch.

### Por que e stateful?

Diferente dos demais workers (stateless, processam jobs sob demanda), o uptime-checker-worker **gerencia seu proprio scheduling**. O webapp nao agenda checks individuais — apenas envia comandos CRUD de monitors. O worker mantém uma registry em memória e auto-agenda a execucao dos checks nos intervalos configurados.

### Fluxo resumido

```
Webapp                          uptime-checker-worker
  │                                    │
  │── uptime:add-site ───────────────→ │  Registra monitor na registry
  │── uptime:update-site ────────────→ │  Atualiza config (intervalo, protocol)
  │── uptime:remove-site ────────────→ │  Remove monitor da registry
  │                                    │
  │                                    │  [tick scheduler a cada 1s]
  │                                    │  → Identifica monitors "due"
  │                                    │  → Executa checks (HTTP, TCP, Ping, DNS)
  │                                    │
  │←── uptime:check-completed ────────│  Publica resultado de cada check
```

### Limitacao: instancia unica

Roda em **1 servidor** (nao escala horizontalmente). Se cair, perde a registry. Na reinicializacao, o worker publica `uptime:worker-started` e o webapp reenvia todos os monitors ativos.

---

## 2. Tech Stack

| Item | Escolha | Notas |
|------|---------|-------|
| Runtime | Node.js 24 (`node:24-slim`) | Mesma imagem do crawler-worker |
| Linguagem | TypeScript strict mode | `tsconfig.json` identico |
| Arquitetura | Hexagonal (Ports & Adapters) | Mesma estrutura do crawler-worker |
| Message Broker | amqplib | RabbitMQ |
| Validacao env | Zod | Schema tipado |
| Logging | Pino + pino-pretty (dev) | Structured logging |
| Testes | Vitest | Mesma config |
| Build | tsc (prod), tsx watch (dev) | |
| Container | Docker multi-stage | |

### Dependencias nativas (sem libs externas)

| Protocolo | Modulo Node.js |
|-----------|----------------|
| HTTP/HTTPS | `node:http`, `node:https` |
| TLS cert check | `node:tls` (via `socket.getPeerCertificate()`) |
| TCP | `node:net` |
| Ping (ICMP) | `node:child_process` (`ping -c 1`) |
| DNS | `node:dns/promises` |

**Nao precisa de:** `@aws-sdk/*`, `mime-types` (nao faz upload S3).

---

## 3. Estrutura de Diretorios

```
uptime-checker-worker/
├── src/
│   ├── domain/
│   │   ├── interfaces/
│   │   │   ├── message-broker.interface.ts      # IMessageBroker (mesmo contrato do crawler-worker)
│   │   │   ├── uptime-checker.interface.ts      # IUptimeChecker (port por protocolo)
│   │   │   └── monitor-scheduler.interface.ts   # IMonitorScheduler
│   │   ├── events/
│   │   │   ├── monitor-command.event.ts         # AddSiteCommand, UpdateSiteCommand, RemoveSiteCommand
│   │   │   ├── check-completed.event.ts         # CheckCompletedEvent
│   │   │   └── wide-event.ts                    # WideEvent (adaptado para uptime)
│   │   └── value-objects/
│   │       ├── protocol.ts                      # Protocol enum
│   │       ├── uptime-status.ts                 # UptimeStatus enum
│   │       ├── monitor-config.ts                # MonitorConfig (imutavel)
│   │       └── check-result.ts                  # CheckResult (imutavel)
│   ├── application/
│   │   └── services/
│   │       ├── monitor-manager.service.ts       # Registry + orquestracao central
│   │       └── monitor-manager.service.spec.ts
│   ├── infra/
│   │   ├── adapters/
│   │   │   ├── rabbitmq.adapter.ts              # Adaptado para topologia uptime
│   │   │   ├── rabbitmq.adapter.spec.ts
│   │   │   └── checkers/
│   │   │       ├── http.checker.ts              # HTTP/HTTPS + TLS cert + keyword
│   │   │       ├── http.checker.spec.ts
│   │   │       ├── tcp.checker.ts               # TCP connect
│   │   │       ├── tcp.checker.spec.ts
│   │   │       ├── ping.checker.ts              # ICMP ping via child_process
│   │   │       ├── ping.checker.spec.ts
│   │   │       ├── dns.checker.ts               # DNS resolve
│   │   │       ├── dns.checker.spec.ts
│   │   │       └── checker.factory.ts           # Protocol → IUptimeChecker
│   │   ├── scheduler/
│   │   │   ├── tick-scheduler.ts                # Tick-based scheduler (implementa IMonitorScheduler)
│   │   │   └── tick-scheduler.spec.ts
│   │   ├── config/
│   │   │   ├── env.ts                           # Zod schema
│   │   │   └── logger.ts                        # Pino config
│   │   ├── health/
│   │   │   ├── health.service.ts
│   │   │   ├── health.service.spec.ts
│   │   │   ├── health.server.ts
│   │   │   └── health.server.spec.ts
│   │   └── observability/
│   │       ├── wide-event.emitter.ts
│   │       └── wide-event.emitter.spec.ts
│   └── main.ts                                  # Bootstrap + graceful shutdown
├── Dockerfile
├── docker-compose.yml
├── Makefile
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── .env.example
├── .gitignore
└── CLAUDE.md
```

---

## 4. Domain Layer

### 4.1 Interfaces (Ports)

#### IMessageBroker

Mesmo contrato do crawler-worker (`crawler-worker/src/domain/interfaces/message-broker.interface.ts`):

```typescript
export interface IMessageBroker {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(exchange: string, routingKey: string, message: any): Promise<void>;
  subscribe(queue: string, handler: (message: any) => Promise<void>): Promise<void>;
  ack(message: any): void;
  nack(message: any, requeue?: boolean): void;
}
```

#### IUptimeChecker

Port para execucao de checks. Cada protocolo implementa esta interface:

```typescript
export interface IUptimeChecker {
  check(config: MonitorConfig): Promise<CheckResult>;
}
```

#### IMonitorScheduler

Port para o scheduler de checks:

```typescript
export interface IMonitorScheduler {
  add(monitorId: number, intervalMs: number, callback: () => Promise<void>): void;
  update(monitorId: number, intervalMs: number): void;
  remove(monitorId: number): void;
  stop(): void;
  getActiveCount(): number;
}
```

### 4.2 Value Objects

#### Protocol

```typescript
export const Protocol = {
  HTTP: 'http',
  HTTPS: 'https',
  TCP: 'tcp',
  PING: 'ping',
  DNS: 'dns',
} as const;

export type Protocol = (typeof Protocol)[keyof typeof Protocol];
```

#### UptimeStatus

```typescript
export const UptimeStatus = {
  UP: 'up',
  DOWN: 'down',
  DEGRADED: 'degraded',
} as const;

export type UptimeStatus = (typeof UptimeStatus)[keyof typeof UptimeStatus];
```

> **Nota:** o status `unknown` existe apenas no webapp (valor default antes do primeiro check). O worker nunca publica `unknown`.

#### MonitorConfig

```typescript
export interface MonitorConfig {
  monitorId: number;
  siteId: number;
  workspaceId: number;
  url: string;
  protocol: Protocol;
  checkIntervalSeconds: number;
  timeoutSeconds: number;
  expectedStatusCode?: number;
  keywordCheck?: string;
}
```

#### CheckResult

```typescript
export interface CheckResult {
  status: UptimeStatus;
  responseTimeMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
  ipAddress: string | null;
  tlsCertificateDaysRemaining: number | null;
}
```

### 4.3 Events / Commands

#### Comandos recebidos (Webapp → Worker)

```typescript
// uptime:add-site
export interface AddSiteCommand {
  monitor_id: number;
  site_id: number;
  workspace_id: number;
  url: string;
  protocol: Protocol;
  check_interval_seconds: number;
  timeout_seconds: number;
  expected_status_code?: number;
  keyword_check?: string;
  idempotency_key: string;
}

// uptime:update-site (mesmo shape — substituicao completa)
export interface UpdateSiteCommand {
  monitor_id: number;
  site_id: number;
  workspace_id: number;
  url: string;
  protocol: Protocol;
  check_interval_seconds: number;
  timeout_seconds: number;
  expected_status_code?: number;
  keyword_check?: string;
  idempotency_key: string;
}

// uptime:remove-site
export interface RemoveSiteCommand {
  monitor_id: number;
  idempotency_key: string;
}
```

#### Eventos publicados (Worker → Webapp)

```typescript
// uptime:check-completed
export interface CheckCompletedEvent {
  monitor_id: number;
  site_id: number;
  workspace_id: number;
  status: UptimeStatus;
  response_time_ms: number | null;
  status_code: number | null;
  error_message: string | null;
  ip_address: string | null;
  tls_certificate_days_remaining: number | null;
  checked_at: string;           // ISO 8601
  idempotency_key: string;      // ${monitorId}:${minuto_truncado}
}

// uptime:worker-started (bootstrap sync)
export interface WorkerStartedEvent {
  started_at: string;           // ISO 8601
  instance_id: string;          // UUID gerado no boot
}
```

---

## 5. Application Layer — MonitorManager

O `MonitorManager` e o servico central. Ele orquestra a registry, o scheduler e os checkers.

### Responsabilidades

1. **Registry em memória** — `Map<number, MonitorEntry>`
2. **Recebe comandos** — `addMonitor`, `updateMonitor`, `removeMonitor`
3. **Executa checks** — `executeCheck(monitorId)`
4. **Publica resultados** — via `IMessageBroker`
5. **Gera idempotency key** — `${monitorId}:${Math.floor(Date.now() / 60000)}`

### MonitorEntry

```typescript
interface MonitorEntry {
  config: MonitorConfig;
  nextCheckAt: number;    // timestamp ms
  lastCheckAt?: number;   // timestamp ms
}
```

### Dependencias (injetadas via construtor)

```typescript
class MonitorManager {
  constructor(
    private readonly scheduler: IMonitorScheduler,
    private readonly checkerFactory: CheckerFactory,
    private readonly broker: IMessageBroker,
    private readonly wideEventEmitter: WideEventEmitter,
  ) {}
}
```

> Depende **apenas** de interfaces de dominio. Nenhuma dependencia de infra.

### Fluxo de execucao de um check

```
1. tick scheduler dispara callback para monitorId
2. MonitorManager.executeCheck(monitorId)
3. checkerFactory.getChecker(config.protocol) → IUptimeChecker
4. checker.check(config) → CheckResult
5. Constroi CheckCompletedEvent com resultado + idempotency_key
6. broker.publish('uptime.results', 'check.completed', event)
7. wideEventEmitter.emit(wideEvent)
8. Atualiza lastCheckAt na registry
```

### Tratamento de comandos

| Comando | Acao |
|---------|------|
| `addMonitor` | Valida que monitorId nao existe. Adiciona ao Map. Chama `scheduler.add(monitorId, intervalMs, callback)`. |
| `updateMonitor` | Atualiza config no Map. Chama `scheduler.update(monitorId, newIntervalMs)`. |
| `removeMonitor` | Remove do Map. Chama `scheduler.remove(monitorId)`. |

---

## 6. Infrastructure Layer

### 6.1 Protocol Checkers

Cada checker implementa `IUptimeChecker`. Todos seguem o mesmo padrao:

1. Iniciam medicao de tempo (`Date.now()`)
2. Executam a operacao de rede com timeout
3. Retornam `CheckResult`
4. Em caso de erro/timeout: `status: 'down'` com `errorMessage`

#### HttpChecker (HTTP/HTTPS)

- Usa `node:http` ou `node:https` conforme `config.protocol`
- Mede `responseTimeMs` do inicio do request ate o fim do response
- Para HTTPS: extrai `socket.getPeerCertificate()` para calcular `tlsCertificateDaysRemaining`
- Verifica `expectedStatusCode` (default 200). Se diferente: `status: 'down'`
- Se `keywordCheck` definido: le o body e verifica se contem a keyword. Se nao: `status: 'down'`, `errorMessage: 'Keyword not found'`
- Se `responseTimeMs > DEGRADED_THRESHOLD_MS` (default 5000ms): `status: 'degraded'`
- Timeout via `AbortController` com `setTimeout`
- Extrai `ipAddress` do socket remoto

#### TcpChecker

- Usa `node:net` → `net.connect(port, host)`
- Mede tempo ate o evento `connect`
- Binario: `up` ou `down` (sem `degraded`)
- Nao tem `statusCode`, nao tem TLS
- Timeout via `socket.setTimeout()`
- URL parsing: extrai `host` e `port` da URL do monitor

#### PingChecker

- Usa `node:child_process` → `exec('ping -c 1 -W <timeout> <host>')`
- Parse do stdout para extrair round-trip time (regex no output do ping)
- `status: 'up'` se exit code 0, `'down'` caso contrario
- `responseTimeMs` = RTT do parse
- `ipAddress` extraido do output do ping
- Nao tem `statusCode`, nao tem TLS
- Timeout via flag `-W` do ping + `timeout` option do `exec`

#### DnsChecker

- Usa `node:dns/promises` → `dns.resolve(hostname)`
- Mede tempo de resolucao
- `status: 'up'` se resolve com sucesso, `'down'` se falhar (ENOTFOUND, TIMEOUT, etc.)
- `ipAddress` = primeiro IP retornado
- Nao tem `statusCode`, nao tem TLS
- Timeout via `AbortController` (Node.js 18+)

#### CheckerFactory

```typescript
class CheckerFactory {
  private readonly checkers: Map<Protocol, IUptimeChecker>;

  constructor() {
    this.checkers = new Map([
      ['http', new HttpChecker()],
      ['https', new HttpChecker()],  // mesmo checker, protocol diferente
      ['tcp', new TcpChecker()],
      ['ping', new PingChecker()],
      ['dns', new DnsChecker()],
    ]);
  }

  getChecker(protocol: Protocol): IUptimeChecker {
    const checker = this.checkers.get(protocol);
    if (!checker) throw new Error(`No checker for protocol: ${protocol}`);
    return checker;
  }
}
```

### 6.2 Scheduler — Tick-Based

#### Por que tick-based e nao setInterval por monitor?

| Abordagem | Problema |
|-----------|---------|
| 1 `setInterval` por monitor | Com 10.000 monitors = 10.000 timers ativos. Overhead de GC, timer drift, sem controle de concorrencia nativo |
| **Tick-based (escolhido)** | 1 unico `setInterval(1000ms)`. A cada tick, percorre monitors e executa os "due". Controle preciso de concorrencia |

#### Implementacao

```typescript
class TickScheduler implements IMonitorScheduler {
  private readonly monitors: Map<number, SchedulerEntry>;
  private tickTimer: NodeJS.Timeout | null = null;
  private activeChecks: number = 0;

  constructor(
    private readonly tickIntervalMs: number,      // default: 1000
    private readonly maxConcurrentChecks: number,  // default: 50
  ) {}

  start(): void {
    this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  private async tick(): void {
    const now = Date.now();
    const dueMonitors = [...this.monitors.entries()]
      .filter(([_, entry]) => now >= entry.nextCheckAt)
      .sort((a, b) => a[1].nextCheckAt - b[1].nextCheckAt); // mais atrasado primeiro

    for (const [monitorId, entry] of dueMonitors) {
      if (this.activeChecks >= this.maxConcurrentChecks) break;

      this.activeChecks++;
      entry.nextCheckAt = now + entry.intervalMs;

      // Fire-and-forget com try/catch individual
      entry.callback()
        .catch(() => {}) // erros tratados dentro do callback
        .finally(() => { this.activeChecks--; });
    }
  }

  // add, update, remove, stop, getActiveCount...
}
```

#### Cenario de referencia

- 10.000 monitors, intervalo medio 2 min
- ~83 checks/segundo necessarios
- Com `MAX_CONCURRENT_CHECKS=100` e timeout medio 5s: throughput ~20 checks/s
- Para volume alto, ajustar `MAX_CONCURRENT_CHECKS` conforme capacidade de rede

### 6.3 RabbitMQ Adapter

Baseado no `crawler-worker/src/infra/adapters/rabbitmq.adapter.ts`, adaptado para topologia uptime.

#### Topologia

```
Exchanges:
  uptime.commands  (topic, durable) — webapp publica comandos
  uptime.results   (topic, durable) — worker publica resultados

Queues:
  uptime.commands.pending — consome comandos
    bindings:
      uptime.commands → site.add
      uptime.commands → site.update
      uptime.commands → site.remove

  uptime.commands.dlq — dead letter queue

Prefetch: 10 (comandos sao leves, processados imediatamente)
```

#### Roteamento de comandos

O handler de subscribe precisa rotear a mensagem para o metodo correto do MonitorManager baseado no routing key:

```typescript
await broker.subscribe('uptime.commands.pending', async (msg) => {
  const routingKey = msg.fields.routingKey;
  const content = JSON.parse(msg.content.toString());

  switch (routingKey) {
    case 'site.add':
      monitorManager.addMonitor(content);
      break;
    case 'site.update':
      monitorManager.updateMonitor(content);
      break;
    case 'site.remove':
      monitorManager.removeMonitor(content);
      break;
  }
});
```

> **Nota:** para suportar routing key no handler, o `subscribe` precisa expor o raw message (ou o adapter precisa de um metodo `subscribeWithRouting`). Avaliar se expoe o `ConsumeMessage` do amqplib ou cria uma abstracao.

### 6.4 Health Endpoint

HTTP server em `HEALTH_PORT` (default 3001):

| Endpoint | Resposta |
|----------|---------|
| `GET /health` | `200` se o processo esta rodando |
| `GET /ready` | `200` se RabbitMQ conectado E scheduler ativo |

Payload de `/health`:

```json
{
  "status": "healthy",
  "uptime_seconds": 3600,
  "monitors_active": 150,
  "checks_total": 45000,
  "checks_failed": 23,
  "active_checks": 12,
  "scheduler_running": true,
  "rabbitmq_connected": true
}
```

---

## 7. Contratos de Mensagens (JSON)

### 7.1 Consumidas (Webapp → Worker)

#### `uptime:add-site` (routing key: `site.add`)

```json
{
  "monitor_id": 123,
  "site_id": 456,
  "workspace_id": 789,
  "url": "https://example.com",
  "protocol": "https",
  "check_interval_seconds": 60,
  "timeout_seconds": 30,
  "expected_status_code": 200,
  "keyword_check": null,
  "idempotency_key": "add-monitor-123-1711500000"
}
```

#### `uptime:update-site` (routing key: `site.update`)

```json
{
  "monitor_id": 123,
  "site_id": 456,
  "workspace_id": 789,
  "url": "https://example.com",
  "protocol": "https",
  "check_interval_seconds": 30,
  "timeout_seconds": 15,
  "expected_status_code": 200,
  "keyword_check": "Welcome",
  "idempotency_key": "update-monitor-123-1711500000"
}
```

#### `uptime:remove-site` (routing key: `site.remove`)

```json
{
  "monitor_id": 123,
  "idempotency_key": "remove-monitor-123-1711500000"
}
```

### 7.2 Publicadas (Worker → Webapp)

#### `uptime:check-completed` (routing key: `check.completed`)

```json
{
  "monitor_id": 123,
  "site_id": 456,
  "workspace_id": 789,
  "status": "up",
  "response_time_ms": 245,
  "status_code": 200,
  "error_message": null,
  "ip_address": "93.184.216.34",
  "tls_certificate_days_remaining": 45,
  "checked_at": "2026-03-27T14:30:00.000Z",
  "idempotency_key": "123:29659230"
}
```

#### `uptime:worker-started` (routing key: `worker.started`)

```json
{
  "started_at": "2026-03-27T14:00:00.000Z",
  "instance_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

---

## 8. Configuracao (env.ts)

```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // RabbitMQ
  RABBITMQ_URL: z.string().url(),

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
```

### .env.example

```env
NODE_ENV=development
RABBITMQ_URL=amqp://guest:guest@localhost:5672
MAX_CONCURRENT_CHECKS=50
TICK_INTERVAL_MS=1000
DEFAULT_TIMEOUT_MS=30000
DEGRADED_THRESHOLD_MS=5000
HEALTH_PORT=3001
LOG_LEVEL=info
```

---

## 9. Bootstrap e Graceful Shutdown

### Bootstrap (`main.ts`)

```
1. Validar env (Zod)
2. Inicializar adapters (RabbitMQ, CheckerFactory, TickScheduler, WideEventEmitter)
3. Inicializar MonitorManager com adapters
4. Conectar RabbitMQ
5. Iniciar Health Server
6. Subscribe na queue uptime.commands.pending (roteando para MonitorManager)
7. Iniciar TickScheduler
8. Publicar uptime:worker-started (bootstrap sync)
9. Registrar handlers de SIGINT/SIGTERM
10. Log: "Worker is running"
```

### Graceful Shutdown

```
SIGINT/SIGTERM recebido:
1. scheduler.stop()              — para de disparar novos checks
2. Aguardar checks in-flight     — polling a cada 100ms ate activeChecks === 0 (timeout 10s)
3. healthServer.stop()
4. broker.disconnect()
5. process.exit(0)
```

---

## 10. Error Handling e Resiliencia

### Check failures

Cada checker tem try/catch individual. Qualquer excecao vira:
- `status: 'down'`
- `errorMessage: <descricao do erro>`

O scheduler **nunca para** por causa de um check falhado.

### RabbitMQ disconnect

- Reconnect com retry a cada 5s (mesmo padrao do crawler-worker)
- Durante disconnect:
  - Checks **continuam executando** (scheduler nao depende do broker)
  - Resultados sao **bufferizados em memória** (limite: 1000 eventos). Ao reconectar, drena o buffer
  - Comandos nao sao recebidos (registry fica stale ate reconexao)

### Bootstrap sync

Quando o worker inicia (ou reconecta apos queda prolongada):

1. Worker publica `uptime:worker-started` no exchange `uptime.results` (routing key `worker.started`)
2. Webapp ouve este evento e reenvia todos os `uptime:add-site` para monitors ativos
3. Worker popula a registry e comeca a agendar checks

> **Idempotencia de add:** se o worker receber `add-site` para um monitorId que ja existe na registry, trata como update (substitui config).

### Timeouts dos checkers

| Protocolo | Mecanismo de timeout |
|-----------|---------------------|
| HTTP/HTTPS | `AbortController` com `setTimeout` |
| TCP | `socket.setTimeout()` |
| Ping | Flag `-W` do ping + `timeout` do `exec` |
| DNS | `AbortController` (Node.js 18+) |

Timeout excedido → `status: 'down'`, `errorMessage: 'Timeout after Xms'`

---

## 11. Observabilidade

### Wide Events

Adaptado do padrao do crawler-worker (`crawler-worker/src/domain/events/wide-event.ts`):

```typescript
interface UptimeWideEvent {
  // Core
  service: 'uptime-checker-worker';
  operation: 'check.execute';
  timestamp: string;
  duration: number;

  // Context
  monitorId: number;
  siteId: number;
  workspaceId: number;
  protocol: Protocol;
  url: string;

  // Result
  status: UptimeStatus;
  responseTimeMs: number | null;
  statusCode: number | null;
  tlsCertDaysRemaining: number | null;

  // Outcome
  outcome: 'ok' | 'error';
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };

  // Environment
  environment?: {
    nodeEnv?: string;
  };
}
```

### Metricas no Health Endpoint

| Metrica | Descricao |
|---------|-----------|
| `monitors_active` | Total de monitors na registry |
| `checks_total` | Contador de checks executados desde o boot |
| `checks_failed` | Contador de checks com status `down` |
| `active_checks` | Checks em execucao neste momento |
| `scheduler_running` | Se o tick scheduler esta ativo |

### Logging

Pino com child loggers contextuais:
- `bootstrap` — inicializacao
- `scheduler` — tick events, monitors due
- `checker:<protocol>` — execucao de checks
- `rabbitmq` — conexao, publish, subscribe
- `health` — requests ao health endpoint

Em producao: apenas wide events (Pino level `warn`). Em dev: level `debug` com pino-pretty.

---

## 12. Docker

### Dockerfile

Multi-stage identico ao crawler-worker, porem:
- **Sem** copia do SiteOne Crawler binary
- **Sem** `TMP_DIR` (nao gera arquivos temporarios)
- **Com** `iputils-ping` para o PingChecker funcionar

```dockerfile
# Stage 1: Build
FROM node:24-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src/ src/
RUN npm run build

# Stage 2: Production
FROM node:24-slim AS production
RUN apt-get update && apt-get install -y iputils-ping && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
CMD ["node", "dist/main.js"]
```

### docker-compose.yml

```yaml
services:
  uptime-checker-worker:
    build: .
    env_file: .env
    depends_on:
      rabbitmq:
        condition: service_healthy
    ports:
      - "3001:3001"
    restart: unless-stopped
    networks:
      - sitewatch

  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "check_running"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - sitewatch

networks:
  sitewatch:
    driver: bridge
```

### Makefile

```makefile
.PHONY: dev test build clean

dev:
	docker compose up --build

infra:
	docker compose up rabbitmq

test:
	npx vitest run

test-watch:
	npx vitest watch

test-coverage:
	npx vitest run --coverage

build:
	npx tsc -p tsconfig.build.json

clean:
	rm -rf dist
```

---

## 13. Estrategia de Testes

### Unit Tests (dominio puro)

| Teste | O que valida |
|-------|-------------|
| `MonitorConfig` | Construcao, campos obrigatorios, valores default |
| `CheckResult` | Construcao, status mapping |
| `Protocol` | Valores validos |
| `UptimeStatus` | Valores validos |
| `CheckerFactory` | Retorna checker correto por protocolo, erro para protocolo invalido |

### Unit Tests (checkers com mock de I/O)

| Teste | Mock | Cenarios |
|-------|------|---------|
| `HttpChecker` | `node:http/https` request | 200 → up, 500 → down, timeout → down, keyword hit → up, keyword miss → down, TLS cert extraction, degraded threshold |
| `TcpChecker` | `node:net` connect | Connect ok → up, ECONNREFUSED → down, timeout → down |
| `PingChecker` | `child_process.exec` | Exit 0 + parse RTT → up, exit 1 → down, timeout → down |
| `DnsChecker` | `node:dns/promises` | Resolve ok → up + IP, ENOTFOUND → down, timeout → down |

### Unit Tests (application)

| Teste | Mocks | Cenarios |
|-------|-------|---------|
| `MonitorManager` | IUptimeChecker, IMonitorScheduler, IMessageBroker | addMonitor registra e agenda, updateMonitor atualiza e re-agenda, removeMonitor limpa, executeCheck chama checker e publica resultado, idempotency key gerada corretamente, addMonitor com ID existente = update |

### Unit Tests (scheduler)

| Teste | Cenarios |
|-------|---------|
| `TickScheduler` | add/remove/update monitors, tick dispara callbacks corretas, respeita MAX_CONCURRENT_CHECKS, monitors atrasados tem prioridade, stop para o timer |

### Integration Tests

| Teste | Infra real | O que valida |
|-------|-----------|-------------|
| `RabbitMQ adapter` | RabbitMQ container | Publish/subscribe, ack/nack, routing keys, reconnect, topologia criada corretamente |

---

## 14. Decisoes Tecnicas

### ADR-UT-001: Tick-based scheduler vs setInterval por monitor

**Decisao:** tick-based com 1 unico timer de 1s.

**Motivo:** controle preciso de concorrencia, sem overhead de milhares de timers, facil de inspecionar o estado interno para debugging e health checks.

### ADR-UT-002: Buffer de resultados durante disconnect do RabbitMQ

**Decisao:** buffer em memória com limite de 1000 eventos. Ao reconectar, drena o buffer na ordem original.

**Motivo:** checks continuam durante disconnect (scheduler e independente). Sem buffer, resultados seriam perdidos. Limite de 1000 previne memory leak em caso de disconnect prolongado.

### ADR-UT-003: Bootstrap sync via evento pull

**Decisao:** worker publica `uptime:worker-started`, webapp re-envia todos os monitors.

**Motivo:** mais simples que manter persistencia no worker. O webapp ja tem a lista completa de monitors no banco. O worker e efemero — sua verdade vem do webapp.

### ADR-UT-004: HttpChecker unificado para HTTP e HTTPS

**Decisao:** um unico `HttpChecker` que decide entre `node:http` e `node:https` baseado no `config.protocol`.

**Motivo:** a logica e 95% identica. Separar criaria duplicacao desnecessaria. TLS cert check e um `if` extra.
