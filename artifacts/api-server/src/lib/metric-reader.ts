import { currentPool } from "./tenant";
import type { PoolClient } from "pg";

/** Each metrics session assumes a role granted SELECT only on the two canonical views. */
export async function withMetricReader<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await currentPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL ROLE erp_metric_reader");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
