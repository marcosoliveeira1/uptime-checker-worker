import type { CheckResult } from "../value-objects/check-result";
import type { MonitorConfig } from "../value-objects/monitor-config";

export interface IUptimeChecker {
    check(config: MonitorConfig): Promise<CheckResult>;
}
