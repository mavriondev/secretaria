import { startRetencao } from "./lib/retencao";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureDemoCompany } from "./lib/auth";
import { startScheduler } from "./lib/carga-empresa";
import { startAvisos } from "./lib/avisos";
import { startSaudeSistema } from "./lib/saude-sistema";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

ensureDemoCompany().then(() => app.listen({ port, host: process.env.LISTEN_HOST ?? "0.0.0.0" })).then(() => { startScheduler(); startAvisos(); startSaudeSistema(); startRetencao(); }).catch(error => {
  logger.error({ err: error }, "Error listening on port");
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => app.close().then(() => process.exit(0)));
}
