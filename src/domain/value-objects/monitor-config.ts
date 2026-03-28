import { Protocol } from './protocol';

export interface MonitorConfig {
  monitorId: string;
  siteId: string;
  workspaceId: string;
  url: string;
  protocol: Protocol;
  checkIntervalSeconds: number;
  timeoutSeconds: number;
  expectedStatusCode?: number;
  acceptedStatusCodes?: number[];
  followRedirects?: boolean;
  slowThresholdMs?: number;
  checkSsl?: boolean;
  sslExpiryReminderDays?: number;
  keywordCheck?: string;
}
