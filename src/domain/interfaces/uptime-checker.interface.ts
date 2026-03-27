import { MonitorConfig } from '../value-objects/monitor-config';
import { CheckResult } from '../value-objects/check-result';

export interface IUptimeChecker {
  check(config: MonitorConfig): Promise<CheckResult>;
}
