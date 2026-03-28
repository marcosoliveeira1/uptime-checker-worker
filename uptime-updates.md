# Uptime Service — Pendências e Melhorias

Documento de referência para alinhar o `uptime-checker-worker` (Node.js) com o que
o `webapp` (Laravel) já envia e espera receber. Baseado na leitura direta do código
de ambos os serviços em 2026-03-28.

---

## 1. Contrato de Mensagens — Divergências Críticas

### 1.1 Tipos de ID (blocker)

**Problema:** O worker define todos os IDs como `number`, mas o webapp usa ULIDs (`string`).

```typescript
// worker: monitor-command.event.ts — ATUAL (errado)
export interface AddSiteCommand {
    monitor_id: number; // ❌
    site_id: number; // ❌
    workspace_id: number; // ❌
}

// worker: monitor-config.ts — ATUAL (errado)
export interface MonitorConfig {
    monitorId: number; // ❌
    siteId: number; // ❌
    workspaceId: number; // ❌
}
```

**Correção necessária no worker:** trocar todos os IDs para `string`.

```typescript
// CORRETO
export interface AddSiteCommand {
    monitor_id: string;
    site_id: string;
    workspace_id: string;
    // ...
}
```

> **Impacto:** se o worker tentar comparar ou usar esses IDs como números, o comportamento
> é indefinido. O `RemoveSiteCommand` usa `monitor_id` para lookup no Map — com mismatch
> de tipo, `removeMonitor` nunca encontra o monitor.

---

### 1.2 Campos Enviados pelo Webapp que o Worker Ignora

O webapp já publica esses campos no `site.add` / `site.update`, mas o worker não os
lê nem os aplica:

| Campo                      | Tipo            | Comportamento atual do worker                | Comportamento esperado                                               |
| -------------------------- | --------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| `follow_redirects`         | `bool`          | Sempre usa `http.get()` sem seguir redirects | Configurar `followRedirect` por monitor                              |
| `accepted_status_codes`    | `int[] \| null` | Ignora; só verifica `expectedStatusCode`     | Aceitar qualquer código da lista                                     |
| `slow_threshold_ms`        | `int \| null`   | Usa `env.DEGRADED_THRESHOLD_MS` (global)     | Usar threshold por monitor                                           |
| `check_ssl`                | `bool`          | Sempre extrai TLS para HTTPS                 | Só extrair/alertar quando `true`                                     |
| `ssl_expiry_reminder_days` | `int \| null`   | Ignorado                                     | Passar de volta no `check.completed` para o webapp decidir se alerta |

**Resultado prático hoje:**

- `follow_redirects: true` → worker recebe o redirect 301 e marca DOWN porque status 301 ≠ 200.
- `accepted_status_codes: [200, 301]` → worker ignora a lista, ainda verifica apenas `expectedStatusCode`.
- `slow_threshold_ms: 1500` → worker usa o valor global do `.env`, não o threshold do monitor.

---

## 2. Alterações Necessárias no Worker

### 2.1 `MonitorConfig` — adicionar campos faltantes

```typescript
// monitor-config.ts
export interface MonitorConfig {
    monitorId: string; // string (ULID)
    siteId: string;
    workspaceId: string;
    url: string;
    protocol: Protocol;
    checkIntervalSeconds: number;
    timeoutSeconds: number;
    expectedStatusCode?: number;
    acceptedStatusCodes?: number[]; // NOVO
    followRedirects?: boolean; // NOVO (default: true)
    keywordCheck?: string;
    slowThresholdMs?: number; // NOVO (override do global)
    checkSsl?: boolean; // NOVO
    sslExpiryReminderDays?: number; // NOVO (passado de volta no check.completed)
}
```

### 2.2 `AddSiteCommand` / `UpdateSiteCommand` — espelhar o MonitorConfig

```typescript
export interface AddSiteCommand {
    monitor_id: string;
    site_id: string;
    workspace_id: string;
    url: string;
    protocol: Protocol;
    check_interval_seconds: number;
    timeout_seconds: number;
    expected_status_code?: number;
    accepted_status_codes?: number[]; // NOVO
    follow_redirects?: boolean; // NOVO
    keyword_check?: string;
    slow_threshold_ms?: number; // NOVO
    check_ssl?: boolean; // NOVO
    ssl_expiry_reminder_days?: number; // NOVO
    idempotency_key: string;
}
```

### 2.3 `HttpChecker` — implementar `follow_redirects` e `accepted_status_codes`

**`follow_redirects`:**
Node.js `http.get()` não segue redirects por padrão. Quando `followRedirects: true`,
o checker precisa seguir manualmente (ou usar uma biblioteca como `undici` que suporta
`maxRedirections`).

```typescript
// Lógica de status code com accepted_status_codes
const expectedStatus = config.expectedStatusCode ?? 200;
const acceptedCodes = config.acceptedStatusCodes;

const isAccepted = acceptedCodes
    ? acceptedCodes.includes(statusCode)
    : statusCode === expectedStatus;

if (!isAccepted) {
    // → DOWN
}
```

**`slow_threshold_ms` por monitor:**

```typescript
// ANTES — threshold global
const status = responseTimeMs > env.DEGRADED_THRESHOLD_MS ? UptimeStatus.DEGRADED : UptimeStatus.UP;

// DEPOIS — threshold por monitor, com fallback para o global
const threshold = config.slowThresholdMs ?? env.DEGRADED_THRESHOLD_MS;
const status = responseTimeMs > threshold ? UptimeStatus.DEGRADED : UptimeStatus.UP;
```

### 2.4 `CheckCompletedEvent` — adicionar campo `ssl_expiry_warning`

Quando `check_ssl: true` e `ssl_expiry_reminder_days` está configurado, o worker
deve sinalizar no evento de resultado se o certificado está próximo de expirar:

```typescript
// check-completed.event.ts
export interface CheckCompletedEvent {
    monitor_id: string;
    site_id: string;
    workspace_id: string;
    status: UptimeStatus;
    response_time_ms: number | null;
    status_code: number | null;
    error_message: string | null;
    ip_address: string | null;
    tls_certificate_days_remaining: number | null;
    ssl_expiry_warning: boolean; // NOVO: true quando days_remaining <= ssl_expiry_reminder_days
    checked_at: string; // ISO 8601
    idempotency_key: string;
}
```

---

## 3. Alterações Necessárias no Webapp

### 3.1 Deduplicação por `idempotency_key` no Consumer

O worker envia `idempotency_key` em cada `check.completed`, mas o consumer do webapp
(`HandleUptimeCheckCompleted`) não usa esse campo. Se o RabbitMQ redelivery acontecer
(crash durante processamento), o check será salvo duas vezes.

**Correção:** antes de salvar o `UptimeCheck`, verificar se já existe um registro com
esse `idempotency_key`. Requer adicionar a coluna na tabela `uptime_checks`.

```php
// Nova migration
$table->string('idempotency_key')->nullable()->unique();

// Em HandleUptimeCheckCompleted
if ($data->idempotencyKey && $this->checkRepo->existsByIdempotencyKey($data->idempotencyKey)) {
    Log::info('uptime_check_duplicate_skipped', ['key' => $data->idempotencyKey]);
    return;
}
```

### 3.2 Alerta de Expiração SSL

O campo `tls_certificate_days_remaining` é salvo em cada `UptimeCheck`, e
`ssl_expiry_reminder_days` está configurado no monitor — mas **não existe lógica de
alerta** quando o certificado está próximo de vencer.

Opções:

- **Opção A (preferida):** worker envia `ssl_expiry_warning: true` no evento quando
  `days_remaining <= ssl_expiry_reminder_days`, webapp dispara alerta ao receber.
- **Opção B:** webapp verifica `tls_certificate_days_remaining` no
  `HandleUptimeCheckCompleted` e compara com `monitor->ssl_expiry_reminder_days`.

A opção A é preferida porque o worker já tem os dados no momento certo (durante o check).

### 3.3 DTO `UptimeCheckCompletedData` — adicionar campo `ssl_expiry_warning`

```php
readonly class UptimeCheckCompletedData {
    public function __construct(
        // campos existentes...
        public readonly bool $sslExpiryWarning = false, // NOVO
    ) {}
}
```

### 3.4 `UpdateUptimeMonitor` — verificar campos enviados

Confirmar que o `UpdateUptimeMonitor` action publica os novos campos (`follow_redirects`,
`accepted_status_codes`, `slow_threshold_ms`) no payload `site.update`, da mesma forma
que o `CreateUptimeMonitor` já faz.

---

## 4. Melhorias Futuras (não bloqueantes)

### 4.1 Método HTTP (HEAD vs GET)

O worker usa `http.get()` (GET) para todas as verificações HTTP/HTTPS. Usar HEAD seria
mais eficiente (sem body), economizando banda.

**Worker:** adicionar `httpMethod?: 'HEAD' | 'GET' | 'POST'` em `MonitorConfig`.
**Webapp:** desbloquear o campo "Método HTTP" na UI (hoje marcado como "coming soon").

### 4.2 Gráfico de Tempo de Resposta no Dashboard

O controller `UptimeDashboardController` já calcula e envia `responseTimeHistory`
(últimas 24h) como props para a página. A página `Dashboard.tsx` recebe o dado
mas **não renderiza nenhum gráfico**.

Implementar um gráfico de sparkline simples (barras ou linha) no componente do dashboard
usando os dados de `responseTimeHistory: ResponseTimePoint[]`.

### 4.3 Autenticação HTTP (Basic / Bearer)

Prevista na UI (coming soon). Requer:

- Webapp: desbloquear campos na UI, adicionar `auth_type` e `auth_credentials` (criptografados) no model.
- Worker: suporte a header `Authorization` no `HttpChecker`.

### 4.4 Alerta de Domínio Expirado

Previsto na UI (coming soon). Requer integração com um serviço de WHOIS ou DNS para
verificar a data de expiração do domínio — escopo separado do SSL.

---

## 5. Resumo de Prioridades

| #   | Item                                               | Serviço | Severidade |
| --- | -------------------------------------------------- | ------- | ---------- |
| 1   | Corrigir tipos de ID (`number` → `string`)         | worker  | 🔴 Blocker |
| 2   | Implementar `follow_redirects` no HttpChecker      | worker  | 🔴 Alta    |
| 3   | Implementar `accepted_status_codes` no HttpChecker | worker  | 🟡 Média   |
| 4   | Usar `slow_threshold_ms` por monitor (não global)  | worker  | 🟡 Média   |
| 5   | Emitir `ssl_expiry_warning` no `check.completed`   | worker  | 🟡 Média   |
| 6   | Receber e agir em `ssl_expiry_warning` no consumer | webapp  | 🟡 Média   |
| 7   | Deduplicação por `idempotency_key`                 | webapp  | 🟡 Média   |
| 8   | Gráfico de tempo de resposta no Dashboard          | webapp  | 🟢 Baixa   |
| 9   | Método HTTP configurável (HEAD/GET)                | ambos   | 🟢 Baixa   |
| 10  | Autenticação HTTP (Basic/Bearer)                   | ambos   | 🟢 Baixa   |
