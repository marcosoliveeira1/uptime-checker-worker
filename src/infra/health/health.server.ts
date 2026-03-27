import { createServer, Server } from 'http';
import { Logger } from 'pino';
import { HealthService } from './health.service';

export class HealthServer {
  private server: Server | null = null;

  constructor(
    private port: number,
    private healthService: HealthService,
    private logger: Logger
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        // CORS headers for orchestration platforms
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/health' && req.method === 'GET') {
          try {
            const status = await this.healthService.check();

            const statusCode = status.status === 'healthy' ? 200 : 503;
            res.writeHead(statusCode);
            res.end(JSON.stringify(status));
          } catch (error) {
            this.logger.error(error, 'Health check failed');
            res.writeHead(500);
            res.end(
              JSON.stringify({
                status: 'unhealthy',
                error: error instanceof Error ? error.message : 'Unknown error',
              })
            );
          }
          return;
        }

        if (req.url === '/ready' && req.method === 'GET') {
          const status = await this.healthService.check();
          const statusCode = status.status === 'healthy' ? 200 : 503;
          res.writeHead(statusCode);
          res.end(JSON.stringify({ ready: status.status === 'healthy' }));
          return;
        }

        // 404 for unknown paths
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.server.listen(this.port, () => {
        this.logger.info({ port: this.port }, 'Health server started');
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) reject(error);
        else {
          this.logger.info('Health server stopped');
          resolve();
        }
      });
    });
  }
}
