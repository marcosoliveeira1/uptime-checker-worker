# SiteOne Crawler Worker

> **Parte do [SiteWatch](../specs.md)** — Serviço #2 na arquitetura de microservices (ver seção 2 da spec).

Microservice de alta performance que processa jobs de crawling de forma assíncrona, escalável e stateless. Consome mensagens do **RabbitMQ** publicadas pelo webapp, executa o binário do *SiteOne Crawler*, envia os resultados para **MinIO/S3** e publica eventos de conclusão de volta no RabbitMQ.

![Node.js](https://img.shields.io/badge/Node.js-v22-green)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ-Event%20Driven-orange)
![MinIO](https://img.shields.io/badge/MinIO-S3%20Storage-red)
![Docker](https://img.shields.io/badge/Docker-Container-blue)

### Papel na Arquitetura SiteWatch

```
webapp (Laravel) ── crawl.run ──→ [siteone-crawler-worker] ── crawl.completed ──→ webapp
                                         │
                                         ├── Executa SiteOne Crawler binary
                                         ├── Upload resultados para S3
                                         └── Publica evento de conclusão/falha
```

O webapp publica `crawl.run` quando o usuário solicita um crawl manualmente ou quando o scheduler dispara um crawl agendado. Este worker consome a mensagem, executa o crawl e devolve o resultado.

## 🚀 Quick Start

### Prerequisites
1. **Docker & Docker Compose** installed
2. **SiteOne Crawler Binary**: Place the executable at `./siteone-crawler/crawler`

### Development Setup

```bash
# 1. Clone and install dependencies
npm install
make chmod-crawler  # Ensure binary has execute permissions

# 2. Start full dev environment (RabbitMQ + MinIO + Worker)
make dev

# 3. Access management interfaces:
# - RabbitMQ UI: http://localhost:15672 (admin/admin)
# - MinIO Console: http://localhost:9001 (minioadmin/minioadmin)

# 4. Test by publishing a job (see examples/rabbitmq-publisher.js)
node examples/rabbitmq-publisher.js
```

### Development Options

**Option A: Full Stack with Docker**
```bash
make dev           # Start everything (recommended for first-time setup)
make dev-logs      # Follow worker logs
make dev-down      # Stop everything
```

**Option B: Infrastructure + Local Worker**
```bash
make infra         # Start only RabbitMQ + MinIO
npm run dev        # Run worker locally with hot-reload
```

**Option C: Local Development Without Docker**
```bash
# Requires external RabbitMQ and MinIO
# Configure .env with your connection strings
npm run dev
```

---

## 🐳 Production Deployment

### 1. Build Production Image

```bash
# Ensure binary is in place
ls -lh ./siteone-crawler/crawler

# Build optimized production image
make docker-build-prod
```

### 2. Configure Production Environment

```bash
# Copy and configure production environment
cp .env.prod.example .env.prod
nano .env.prod  # Edit with your production values
```

### 3. Deploy

**Option A: Docker Compose**
```bash
make prod-up
make logs-prod  # Monitor logs
```

**Option B: Standalone Container**
```bash
docker run -d \
  --name crawler-worker \
  --env-file .env.prod \
  --restart always \
  siteone-crawler-worker:latest
```

**Option C: Kubernetes / Cloud**
```bash
# Tag and push to your registry
docker tag siteone-crawler-worker:latest your-registry.com/crawler-worker:v1.0.0
docker push your-registry.com/crawler-worker:v1.0.0

# Deploy using your K8s manifests or Helm charts
kubectl apply -f k8s/deployment.yaml
```

---

## ⚙️ Configuration

### Environment Variables

Create `.env` for local development or `.env.prod` for production:

```env
NODE_ENV=production

# Crawler
CRAWLER_PATH=/app/siteone-crawler/crawler
TMP_DIR=/app/tmp
MAX_CONCURRENT_JOBS=5

# RabbitMQ
RABBITMQ_URL=amqp://user:pass@rabbitmq:5672

# MinIO / S3
MINIO_ENDPOINT=https://minio.example.com
MINIO_REGION=us-east-1
MINIO_BUCKET=crawler-results
MINIO_ACCESS_KEY=your-key
MINIO_SECRET_KEY=your-secret
MINIO_USE_SSL=true
```

---

## 🏗️ Architecture & Flow

```mermaid
graph LR
    A[Producer App] -- job.create --> B((RabbitMQ))
    B -- Consume --> C[Crawler Worker]
    C -- Exec --> D[SiteOne Binary]
    D -- Local Files --> C
    C -- Upload --> E[MinIO / S3]
    E -- Public URLs --> C
    C -- job.completed --> B
    B -- Consume Result --> A
```

### Message Contracts (RabbitMQ)

Conforme definido na [spec](../specs.md) seção 7.2 e 7.3.

**Consome: `crawl.run`** (Exchange: `crawler.jobs`, Routing Key: `job.create`)
```json
{
  "jobId": "uuid-v7",
  "siteId": 123,
  "workspaceId": 456,
  "url": "https://example.com",
  "options": {
    "maxDepth": 2,
    "workers": 5,
    "timeout": 60
  },
  "source": "manual|scheduled",
  "idempotencyKey": "crawl-123-2026-03-18",
  "timestamp": "2026-03-18T12:00:00Z"
}
```

**Publica: `crawl.completed`** (Exchange: `crawler.results`, Routing Key: `job.completed`)
```json
{
  "jobId": "uuid-v7",
  "siteId": 123,
  "workspaceId": 456,
  "url": "https://example.com",
  "status": "completed",
  "outputFiles": {
    "json": "https://minio.example.com/crawler-results/jobs/uuid/output.json",
    "html": "https://minio.example.com/crawler-results/jobs/uuid/output.html"
  },
  "crawledPages": 25,
  "totalLinks": 67,
  "timestamp": "2026-03-18T12:05:00Z"
}
```

**Publica: `crawl.failed`** (Exchange: `crawler.results`, Routing Key: `job.failed`)
```json
{
  "jobId": "uuid-v7",
  "siteId": 123,
  "workspaceId": 456,
  "url": "https://example.com",
  "status": "failed",
  "error": "Crawler failed (Exit 1): Network timeout",
  "errorCode": "TIMEOUT",
  "timestamp": "2026-03-18T12:05:00Z"
}
```

---

## 📂 Project Structure

```
src/
├── application/       
│   └── services/        # WorkerService: Orchestrates Crawler → S3 → RabbitMQ
├── domain/            
│   ├── events/          # Message payload interfaces
│   └── interfaces/      # Port interfaces (Crawler, Storage, Broker)
├── infra/             
│   ├── adapters/        # Concrete implementations (RabbitMQ, S3, Crawler)
│   ├── config/          # Environment validation (Zod)
│   └── crawler/         # CLI argument builders and utilities
└── main.ts              # Bootstrap: Initializes connections and listeners
```

---

## 🧪 Testing

```bash
# Run all tests
make test

# Watch mode during development
make test-watch

# Generate coverage report
make test-coverage
```

---

## 🛡️ Robustness Features

### 1. Concurrency Control
- Uses RabbitMQ `prefetch` to limit concurrent jobs (`MAX_CONCURRENT_JOBS`)
- Prevents memory exhaustion and system overload

### 2. Auto-Reconnect
- RabbitMQ adapter automatically reconnects on connection failures
- Exponential backoff (5s base delay)

### 3. Graceful Shutdown
- Listens for `SIGTERM` and `SIGINT`
- Kills active crawler processes
- Closes RabbitMQ connections cleanly

### 4. Resource Cleanup
- Automatically deletes local files after successful S3 upload
- Keeps container lightweight

### 5. Isolated Failure Handling
- Failed file uploads don't crash the entire job
- Publishes failure events to enable retry mechanisms

---

## 📊 Monitoring

### Health Checks

**Docker Health Check** (Production)
```yaml
healthcheck:
  test: ["CMD", "node", "-e", "process.exit(0)"]
  interval: 30s
  timeout: 10s
  retries: 3
```

### Logs

```bash
# Development
make dev-logs        # Worker only
make dev-logs-all    # All services

# Production
make logs-prod
docker logs -f siteone-crawler-worker-prod
```

### Metrics Integration

The worker logs structured JSON that can be ingested by:
- **Prometheus** (via custom exporter)
- **DataDog** (via log parsing)
- **CloudWatch** (ECS/Fargate native)

---

## 🚨 Troubleshooting

### Issue: Worker not processing jobs

**Check:**
1. RabbitMQ connection: `docker logs siteone-rabbitmq-dev`
2. Queue bindings: Visit http://localhost:15672 → Queues
3. Worker logs: `make dev-logs`

### Issue: Binary not found

```bash
# Verify binary exists and has permissions
ls -lh ./siteone-crawler/crawler
make chmod-crawler
```

### Issue: MinIO connection failed

```bash
# Test MinIO health
curl http://localhost:9000/minio/health/live

# Check credentials in .env
echo $MINIO_ACCESS_KEY
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Run tests: `make test`
4. Commit changes: `git commit -m 'Add amazing feature'`
5. Push to branch: `git push origin feature/amazing-feature`
6. Open a Pull Request

---

## 📄 License

[Your License Here]

---

## 🔗 Serviços Relacionados (SiteWatch)

| Serviço | Pasta | Descrição |
|---------|-------|-----------|
| **webapp** | `../webapp/` | Painel adm/cliente Laravel. Publica `crawl.run`, consome `crawl.completed` |
| **uptime-checker-worker** | `../uptime-checker-worker/` | Monitor de uptime (a implementar) |
| **notification-worker** | `../notification-worker/` | Despacho de alertas (a implementar) |
| **report-generator-worker** | `../report-generator-worker/` | Geração de PDFs (a implementar) |
| **analysis-worker** | `../analysis-worker/` | PageSpeed, Security, SEO, DNS, Content (a implementar) |

### Dependências Externas

- [SiteOne Crawler](https://crawler.siteone.io) - Binário PHP de crawling
- [RabbitMQ](https://www.rabbitmq.com) - Message broker
- [MinIO](https://min.io) - S3-compatible object storage