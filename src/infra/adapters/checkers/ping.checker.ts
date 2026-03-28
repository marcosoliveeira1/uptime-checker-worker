import { exec } from 'node:child_process';
import { IUptimeChecker } from '../../../domain/interfaces/uptime-checker.interface';
import { MonitorConfig } from '../../../domain/value-objects/monitor-config';
import { CheckResult } from '../../../domain/value-objects/check-result';
import { UptimeStatus } from '../../../domain/value-objects/uptime-status';

const RTT_REGEX = /time[=<](\d+(?:\.\d+)?)\s*ms/;
const IP_REGEX = /\((\d+\.\d+\.\d+\.\d+)\)/;

export class PingChecker implements IUptimeChecker {
  async check(config: MonitorConfig): Promise<CheckResult> {
    const startTime = Date.now();
    const timeoutSeconds = config.timeoutSeconds;

    const url = new URL(config.url);
    const host = url.hostname;

    return new Promise<CheckResult>((resolve) => {
      const command =
        process.platform === 'darwin'
          ? `ping -c 1 -t ${timeoutSeconds} ${host}`
          : `ping -c 1 -W ${timeoutSeconds} ${host}`;

      exec(command, { timeout: (timeoutSeconds + 1) * 1000 }, (error, stdout, stderr) => {
        const responseTimeMs = Date.now() - startTime;

        if (error) {
          resolve({
            status: UptimeStatus.DOWN,
            responseTimeMs,
            statusCode: null,
            errorMessage: error.killed
              ? `Timeout after ${timeoutSeconds}s`
              : stderr || error.message,
            ipAddress: null,
            tlsCertificateDaysRemaining: null,
            sslExpiryWarning: false,
          });
          return;
        }

        // Parse RTT from output
        const rttMatch = stdout.match(RTT_REGEX);
        const rtt = rttMatch ? parseFloat(rttMatch[1]) : null;

        // Parse IP from output
        const ipMatch = stdout.match(IP_REGEX);
        const ipAddress = ipMatch ? ipMatch[1] : null;

        resolve({
          status: UptimeStatus.UP,
          responseTimeMs: rtt ?? responseTimeMs,
          statusCode: null,
          errorMessage: null,
          ipAddress,
          tlsCertificateDaysRemaining: null,
          sslExpiryWarning: false,
        });
      });
    });
  }
}
