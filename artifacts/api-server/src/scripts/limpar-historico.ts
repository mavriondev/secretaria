import { pool } from "@workspace/db";
import { limparHistorico } from "../lib/retencao";
try {
  if (process.argv.some(a => a.startsWith("--") && !["--ensaio", "--executar"].includes(a)) || process.argv.includes("--ensaio") === process.argv.includes("--executar")) throw new Error("Escolha exatamente --ensaio ou --executar.");
  process.stdout.write(JSON.stringify(await limparHistorico({ dryRun: process.argv.includes("--ensaio") })) + "\n");
} finally { await pool.end(); }
