import { pool } from "@workspace/db";
import { prepareMetricAccess } from "../lib/metric-access";
import { logger } from "../lib/logger";

prepareMetricAccess()
  .then(() => logger.info("Canonical views and restricted metric role ready; ERP data unchanged"))
  .catch(error => {
    logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "Metric access initialization failed");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
