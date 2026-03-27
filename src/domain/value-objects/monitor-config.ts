import { Protocol } from './protocol';

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
