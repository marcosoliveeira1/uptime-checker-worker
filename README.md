# uptime-checker-worker

Worker Node.js de monitoramento de uptime. Consome comandos do **RabbitMQ** publicados pelo webapp (Laravel), agenda verificações periódicas por protocolo (HTTP/HTTPS, TCP, Ping, DNS) e publica os resultados de volta para o webapp.

![Node.js](https://img.shields.io/badge/Node.js-v22-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ-Event%20Driven-orange)
![Docker](https://img.shields.io/badge/Docker-Container-blue)

---

## Papel na Arquitetura

```
webapp (Laravel)
  │
  ├── site.add / site.update ──→ [uptime.commands] ──→ uptime-checker-worker
  │                                                         │
  │                                                         ├── agenda intervalo por monitor
  │                                                         ├── executa checker por protocolo
  │                                                         └── publica check.completed
  │
  └──────────────────── [uptime.results] ←── check.completed (status, TLS, latência…)
```

---

## Quick Start

### Pré-requisitos

- Node.js 22+ / pnpm
- RabbitMQ acessível (ou via Docker Compose)

### Desenvolvimento local

```bash
# 1. Instalar dependências
pnpm install

# 2. Copiar e configurar variáveis de ambiente
cp .env.example .env

# 3. Subir RabbitMQ via Docker Compose
docker compose up rabbitmq -d

# 4. Rodar o worker em modo watch
pnpm dev
```

### Docker (stack completa)

```bash
docker compose up -d
docker compose logs -f worker
```

---

## Configuração

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `NODE_ENV` | `development` | Ambiente (`development`, `production`, `test`) |
| `RABBITMQ_URL` | — | URL de conexão RabbitMQ (obrigatório em produção) |
| `MAX_CONCURRENT_CHECKS` | `50` | Máximo de checks rodando em paralelo |
| `TICK_INTERVAL_MS` | `1000` | Intervalo do scheduler interno (ms) |
| `DEFAULT_TIMEOUT_MS` | `30000` | Timeout padrão por check (ms) |
| `DEGRADED_THRESHOLD_MS` | `5000` | Limiar global para status `degraded` (ms). Substituível por monitor via `slow_threshold_ms`. |
| `HEALTH_PORT` | `3001` | Porta do servidor de health check HTTP |
| `LOG_LEVEL` | `info` | Nível de log (pino) |

---

## Contratos de Mensagem (RabbitMQ)

### Comandos consumidos — Exchange `uptime.commands`

**`site.add`** — Registra um novo monitor

```json
{
  "monitor_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "site_id": "01ARZ3NDEKTSV4RRFFQ69G5FB0",
  "workspace_id": "01ARZ3NDEKTSV4RRFFQ69G5FB1",
  "url": "https://example.com",
  "protocol": "https",
  "check_interval_seconds": 60,
  "timeout_seconds": 30,
  "expected_status_code": 200,
  "accepted_status_codes": [200, 201],
  "follow_redirects": true,
  "slow_threshold_ms": 2000,
  "check_ssl": true,
  "ssl_expiry_reminder_days": 30,
  "keyword_check": "Welcome",
  "idempotency_key": "add-abc-1234"
}
```

**`site.update`** — Atualiza a configuração de um monitor existente (mesmos campos de `site.add`)

**`site.remove`** — Remove um monitor

```json
{
  "monitor_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "idempotency_key": "remove-abc-5678"
}
```

> Protocolos suportados: `http`, `https`, `tcp`, `ping`, `dns`

---

### Resultado publicado — Exchange `uptime.results`, routing key `check.completed`

```json
{
  "monitor_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "site_id": "01ARZ3NDEKTSV4RRFFQ69G5FB0",
  "workspace_id": "01ARZ3NDEKTSV4RRFFQ69G5FB1",
  "status": "up",
  "response_time_ms": 143,
  "status_code": 200,
  "error_message": null,
  "ip_address": "93.184.216.34",
  "tls_certificate_days_remaining": 87,
  "ssl_expiry_warning": false,
  "checked_at": "2026-03-28T21:00:00.000Z",
  "idempotency_key": "01ARZ3NDEKTSV4RRFFQ69G5FAV:29400"
}
```

| Campo | Descrição |
|---|---|
| `status` | `up`, `down` ou `degraded` |
| `ssl_expiry_warning` | `true` quando `tls_certificate_days_remaining <= ssl_expiry_reminder_days` |
| `idempotency_key` | `{monitor_id}:{minuto_epoch}` — garante deduplicação no consumer |

---

## Comportamento por Protocolo

| Protocolo | O que verifica | `status_code` | `tls_certificate_days_remaining` |
|---|---|---|---|
| `http` / `https` | Status HTTP, keyword, tempo de resposta, certificado TLS | ✅ | ✅ (apenas `https`) |
| `tcp` | Abertura de socket TCP na porta | null | null |
| `ping` | ICMP ping ao host (RTT via saída do sistema) | null | null |
| `dns` | Resolução DNS A do hostname | null | null |

### Lógica de status (HTTP/HTTPS)

- **`down`** — status code não está em `accepted_status_codes` (ou ≠ `expected_status_code`), keyword ausente, timeout, erro de conexão
- **`degraded`** — resposta válida, mas `response_time_ms > slow_threshold_ms` (ou `DEGRADED_THRESHOLD_MS` global como fallback)
- **`up`** — tudo OK dentro do threshold

---

## Arquitetura Interna

```
src/
├── main.ts                         # Bootstrap: conecta broker, inicia scheduler e worker
├── application/
│   └── services/
│       └── monitor-manager.service.ts  # Orquestra registro, agendamento e execução de checks
├── domain/
│   ├── events/
│   │   ├── monitor-command.event.ts    # AddSiteCommand, UpdateSiteCommand, RemoveSiteCommand
│   │   ├── check-completed.event.ts    # CheckCompletedEvent
│   │   └── wide-event.ts
│   ├── interfaces/
│   │   ├── message-broker.interface.ts
│   │   ├── monitor-scheduler.interface.ts
│   │   └── uptime-checker.interface.ts
│   └── value-objects/
│       ├── monitor-config.ts           # Configuração interna por monitor
│       ├── check-result.ts             # Resultado de um check
│       ├── protocol.ts                 # Enum: http | https | tcp | ping | dns
│       └── uptime-status.ts            # Enum: up | down | degraded
└── infra/
    ├── adapters/
    │   ├── rabbitmq.adapter.ts         # Conexão, publicação e consumo RabbitMQ
    │   └── checkers/
    │       ├── checker.factory.ts      # Retorna o checker correto pelo protocolo
    │       ├── http.checker.ts         # HTTP/HTTPS com TLS, redirect, keyword
    │       ├── tcp.checker.ts          # Conectividade TCP
    │       ├── ping.checker.ts         # ICMP ping
    │       └── dns.checker.ts          # Resolução DNS
    ├── config/
    │   ├── env.ts                      # Validação de env vars com Zod
    │   └── logger.ts                   # Logger estruturado (pino)
    ├── health/
    │   ├── health.server.ts            # Servidor HTTP em HEALTH_PORT
    │   └── health.service.ts           # Métricas: monitors ativos, checks totais/falhos
    ├── observability/
    │   └── wide-event.emitter.ts       # Emite wide events por check para logging
    └── scheduler/
        └── tick-scheduler.ts           # Scheduler em memória baseado em tick
```

---

## Scripts

```bash
pnpm dev              # Watch mode (tsx)
pnpm build            # Compila para dist/
pnpm start            # Roda dist/main.js
pnpm test             # Vitest (single run)
pnpm test:watch       # Vitest em modo watch
pnpm test:coverage    # Coverage report
pnpm typecheck        # tsc sem emitir arquivos
pnpm lint             # ESLint
pnpm lint:fix         # ESLint com auto-fix
pnpm health           # Verifica health check HTTP local
```

---

## Health Check

O worker expõe um endpoint HTTP na porta `HEALTH_PORT` (padrão `3001`):

```
GET /health
```

```json
{
  "status": "ok",
  "monitorsActive": 42,
  "checksTotal": 3600,
  "checksFailed": 12,
  "uptime": 3661.4
}
```

Usado pelo Docker para liveness probe (`scripts/healthcheck.js`).

