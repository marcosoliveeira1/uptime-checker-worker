#!/usr/bin/env node

const http = require("node:http");
const _url = require("node:url");

const HEALTH_URL = process.env.HEALTH_URL || "http://localhost:3000/health";
const TIMEOUT = parseInt(process.env.TIMEOUT || "5000", 10);

async function healthcheck() {
    return new Promise((resolve) => {
        const parsedUrl = new URL(HEALTH_URL);
        const options = {
            hostname: parsedUrl.hostname,
            port:
                parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
            path: parsedUrl.pathname,
            method: "GET",
            timeout: TIMEOUT,
        };

        const req = http.request(options, (res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                try {
                    const health = JSON.parse(data);

                    console.log(`\n📊 Health Check: ${HEALTH_URL}\n`);
                    console.log(`Status: ${health.status?.toUpperCase()}`);
                    console.log(
                        `Uptime: ${(health.uptime / 1000).toFixed(2)}s`,
                    );
                    console.log(`Timestamp: ${health.timestamp}`);

                    if (health.checks) {
                        console.log(`\n🔌 Connections:`);
                        console.log(
                            `  RabbitMQ: ${health.checks.rabbitmq?.connected ? "✅" : "❌"}`,
                        );
                        if (health.checks.rabbitmq?.error) {
                            console.log(
                                `    Error: ${health.checks.rabbitmq.error}`,
                            );
                        }
                        console.log(
                            `  S3/MinIO: ${health.checks.s3?.connected ? "✅" : "❌"}`,
                        );
                        if (health.checks.s3?.error) {
                            console.log(`    Error: ${health.checks.s3.error}`);
                        }
                    }

                    if (health.metrics) {
                        console.log(`\n📈 Metrics:`);
                        console.log(
                            `  Jobs Processed: ${health.metrics.jobsProcessed}`,
                        );
                        if (health.metrics.lastJobProcessedAt) {
                            console.log(
                                `  Last Job: ${new Date(health.metrics.lastJobProcessedAt).toLocaleString()}`,
                            );
                        }
                    }

                    console.log("");

                    // Exit with 0 if healthy, 1 if degraded/unhealthy
                    const exitCode = health.status === "healthy" ? 0 : 1;
                    resolve(exitCode);
                } catch (err) {
                    console.error("❌ Failed to parse response:", err.message);
                    resolve(1);
                }
            });
        });

        req.on("error", (err) => {
            console.error(`❌ Health check failed: ${err.message}`);
            console.error(`   URL: ${HEALTH_URL}`);
            resolve(1);
        });

        req.on("timeout", () => {
            req.destroy();
            console.error(`❌ Health check timeout (${TIMEOUT}ms)`);
            resolve(1);
        });

        req.end();
    });
}

healthcheck().then((exitCode) => {
    process.exit(exitCode);
});
