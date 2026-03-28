import http from 'node:http';
import https from 'node:https';
import { TLSSocket } from 'node:tls';
import { IUptimeChecker } from '../../../domain/interfaces/uptime-checker.interface';
import { MonitorConfig } from '../../../domain/value-objects/monitor-config';
import { CheckResult } from '../../../domain/value-objects/check-result';
import { UptimeStatus } from '../../../domain/value-objects/uptime-status';
import { createCheckerLogger } from '../../config/logger';
import { env } from '../../config/env';

const log = createCheckerLogger('http');

export class HttpChecker implements IUptimeChecker {
  async check(config: MonitorConfig): Promise<CheckResult> {
    const startTime = Date.now();
    const timeoutMs = config.timeoutSeconds * 1000;
    const isHttps = config.protocol === 'https';
    const client = isHttps ? https : http;

    return new Promise<CheckResult>((resolve) => {
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeoutMs);

      try {
        const req = client.get(config.url, { signal: abortController.signal }, (res) => {
          const responseTimeMs = Date.now() - startTime;
          let body = '';
          let ipAddress: string | null = null;
          let tlsCertificateDaysRemaining: number | null = null;
          let sslExpiryWarning = false;

          // Extract IP address from socket
          ipAddress = res.socket?.remoteAddress ?? null;

          // Extract TLS certificate info for HTTPS (conditional on checkSsl flag)
          if (config.checkSsl !== false && isHttps && res.socket instanceof TLSSocket) {
            try {
              const cert = (res.socket as TLSSocket).getPeerCertificate();
              if (cert && cert.valid_to) {
                const expiryDate = new Date(cert.valid_to);
                const now = new Date();
                tlsCertificateDaysRemaining = Math.floor(
                  (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
                );

                // Calculate SSL expiry warning
                if (
                  config.sslExpiryReminderDays &&
                  tlsCertificateDaysRemaining <= config.sslExpiryReminderDays
                ) {
                  sslExpiryWarning = true;
                }
              }
            } catch (err) {
              log.debug({ err }, 'Failed to extract TLS certificate');
            }
          }

          const statusCode = res.statusCode ?? 0;

          // Check status code against accepted codes or expected status
          const acceptedCodes = config.acceptedStatusCodes || [config.expectedStatusCode ?? 200];
          const isStatusOk = acceptedCodes.includes(statusCode);

          if (!isStatusOk) {
            clearTimeout(timer);
            res.resume(); // drain response
            resolve({
              status: UptimeStatus.DOWN,
              responseTimeMs,
              statusCode,
              errorMessage: `Expected one of [${acceptedCodes.join(', ')}], got ${statusCode}`,
              ipAddress,
              tlsCertificateDaysRemaining,
              sslExpiryWarning,
            });
            return;
          }

          // If keyword check is needed, read body
          if (config.keywordCheck) {
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              body += chunk;
            });
            res.on('end', () => {
              clearTimeout(timer);

              if (!body.includes(config.keywordCheck!)) {
                resolve({
                  status: UptimeStatus.DOWN,
                  responseTimeMs,
                  statusCode,
                  errorMessage: 'Keyword not found',
                  ipAddress,
                  tlsCertificateDaysRemaining,
                  sslExpiryWarning,
                });
                return;
              }

              // Use per-monitor threshold if configured, otherwise fall back to env var
              const threshold = config.slowThresholdMs ?? env.DEGRADED_THRESHOLD_MS;
              const status = responseTimeMs > threshold ? UptimeStatus.DEGRADED : UptimeStatus.UP;

              resolve({
                status,
                responseTimeMs,
                statusCode,
                errorMessage: null,
                ipAddress,
                tlsCertificateDaysRemaining,
                sslExpiryWarning,
              });
            });
          } else {
            clearTimeout(timer);
            res.resume(); // drain response

            // Use per-monitor threshold if configured, otherwise fall back to env var
            const threshold = config.slowThresholdMs ?? env.DEGRADED_THRESHOLD_MS;
            const status = responseTimeMs > threshold ? UptimeStatus.DEGRADED : UptimeStatus.UP;

            resolve({
              status,
              responseTimeMs,
              statusCode,
              errorMessage: null,
              ipAddress,
              tlsCertificateDaysRemaining,
              sslExpiryWarning,
            });
          }
        });

        req.on('error', (err: Error) => {
          clearTimeout(timer);
          const responseTimeMs = Date.now() - startTime;

          if (abortController.signal.aborted) {
            resolve({
              status: UptimeStatus.DOWN,
              responseTimeMs,
              statusCode: null,
              errorMessage: `Timeout after ${timeoutMs}ms`,
              ipAddress: null,
              tlsCertificateDaysRemaining: null,
              sslExpiryWarning: false,
            });
            return;
          }

          resolve({
            status: UptimeStatus.DOWN,
            responseTimeMs,
            statusCode: null,
            errorMessage: err.message,
            ipAddress: null,
            tlsCertificateDaysRemaining: null,
            sslExpiryWarning: false,
          });
        });
      } catch (err) {
        clearTimeout(timer);
        resolve({
          status: UptimeStatus.DOWN,
          responseTimeMs: Date.now() - startTime,
          statusCode: null,
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
          ipAddress: null,
          tlsCertificateDaysRemaining: null,
          sslExpiryWarning: false,
        });
      }
    });
  }
}
