import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { pool } from "@workspace/db";
import { alertaRetencao, diasRetencao, estadoRetencao, limpezaVencida, limparHistorico } from "../lib/retencao";

const schema = `retencao_test_${Date.now()}`;
const isolated = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
const now = new Date("2026-10-15T12:00:00Z");
const old = new Date("2026-06-01T12:00:00Z");
const recent = new Date("2026-10-01T12:00:00Z");
const boundary = new Date(now.getTime() - 90 * 86_400_000);
const tables = ["query_logs", "export_documents", "avaliacoes", "execucoes_teste", "resultados_teste", "notificacoes", "sessoes", "redefinicoes_senha", "historico_limpeza", "favoritos", "custos_ia", "empresas", "usuarios", "avisos", "knowledge_items", "plataforma_configuracao", "tetos_eventos"];
const query = (sql: string, values?: unknown[]) => isolated.query(sql, values);
before(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const t of tables) await pool.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING ALL)`);
  // Reproduce the dependencies that LIKE intentionally does not copy.
  await query("ALTER TABLE export_documents ADD FOREIGN KEY(query_log_id) REFERENCES query_logs(id)");
  await query("ALTER TABLE favoritos ADD FOREIGN KEY(query_log_id) REFERENCES query_logs(id) ON DELETE SET NULL");
  await query("ALTER TABLE custos_ia ADD FOREIGN KEY(query_log_id) REFERENCES query_logs(id) ON DELETE SET NULL");
});
after(async () => { await isolated.end(); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); });

test("configuration defaults to 90, permits 7, rejects unsafe input", () => {
  assert.equal(diasRetencao(""), 90); assert.equal(diasRetencao("7"), 7); assert.equal(diasRetencao("120"), 120);
  for (const v of ["0", "6", "-90", "NaN", "7.5", "9e2", "Infinity", "999999999"]) assert.throws(() => diasRetencao(v));
});
test("retention fixture includes two companies, protected saved queries and old review votes", async () => {
  for (const [id, company, date] of [[1, 11, old], [2, 22, old], [3, 11, recent], [4, 22, boundary]] as const)
    await query("INSERT INTO query_logs(id,empresa_id,created_at,question,answer,freedom_level,latency_ms) VALUES($1,$2,$3,'pergunta','resposta',1,10)", [id, company, date]);
  await query("INSERT INTO export_documents(id,empresa_id,query_log_id,title,created_at) VALUES (1,11,1,'antigo',$1),(2,11,3,'recente',$2)", [old, recent]);
  await query("INSERT INTO avaliacoes(id,empresa_id,log_id,usuario_id,motivo,tratativa,criada_em,status) VALUES(1,11,1,5,'antigo','antiga',$1,'revisada')", [old]);
  await query("INSERT INTO avaliacoes(id,empresa_id,log_id,usuario_id,motivo,motivo_em,tratativa,revisada_em,criada_em) VALUES(2,22,2,6,'novo',$1,'nova',$1,$2)", [recent, old]);
  await query("INSERT INTO execucoes_teste(id,empresa_id,usuario_id,status,iniciada_em,total,aprovadas) VALUES(1,11,5,'concluida',$1,1,1),(2,22,6,'executando',$1,1,0)", [old]);
  await query("INSERT INTO resultados_teste(id,execucao_id,pergunta_id,pergunta,resposta,aprovada) VALUES(1,1,1,'antiga','antiga',true),(2,2,2,'ativa','ativa',false)");
  await query("INSERT INTO notificacoes(id,empresa_id,usuario_id,tipo,titulo,mensagem,criado_em,lida_em) VALUES(1,11,5,'aviso','a','a',$1,$2),(2,22,6,'aviso','n','n',$1,NULL),(3,NULL,7,'sistema','s','s',$1,$2)", [old, recent]);
  await query("INSERT INTO sessoes(id,token_hash,usuario_id,expira_em) VALUES(1,'expirada',5,$1),(2,'valida',6,$2),(3,'dono',7,$2)", [old, new Date("2026-12-31T00:00:00Z")]);
  await query("INSERT INTO custos_ia(id,empresa_id,tipo,provedor,unidade,custo_usd,query_log_id,criado_em) VALUES(1,11,'texto','teste','chamada',1.25,1,$1),(2,22,'texto','teste','chamada',2.75,2,$1)", [old]);
  await query("INSERT INTO favoritos(id,empresa_id,usuario_id,titulo,pergunta_original,tipo,sql_salvo,forma,query_log_id,criado_em) VALUES(1,11,5,'favorito','original','vivo','SELECT * FROM vw_frota_veiculos','numero',1,$1)", [old]);
});
test("dry run is read-only and does not create successful execution state", async () => {
  const r = await limparHistorico({ dryRun: true, now, database: isolated });
  assert.equal(r.contagens.respostas, 2); assert.equal(r.contagens.sessoes_expiradas, 1);
  assert.equal((await query("SELECT count(*) FROM query_logs")).rows[0].count, "4");
  assert.equal((await query("SELECT count(*) FROM historico_limpeza")).rows[0].count, "0");
});
test("deletes only expired text, keeps vote/date, active sessions, unread/system notices and ledger", async () => {
  const r = await limparHistorico({ now, database: isolated });
  assert.equal(r.contagens.respostas, 2); assert.equal(r.contagens.documentos, 1);
  assert.deepEqual((await query("SELECT id FROM query_logs ORDER BY id")).rows.map(r => r.id), [3, 4]);
  assert.deepEqual((await query("SELECT id FROM notificacoes ORDER BY id")).rows.map(r => r.id), [2, 3]);
  assert.deepEqual((await query("SELECT token_hash FROM sessoes ORDER BY id")).rows.map(r => r.token_hash), ["valida", "dono"]);
  const reviews = (await query("SELECT * FROM avaliacoes ORDER BY id")).rows;
  assert.equal(reviews[0].motivo, ""); assert.equal(reviews[0].tratativa, ""); assert.equal(reviews[0].status, "revisada"); assert.equal(reviews[0].criada_em.toISOString(), old.toISOString());
  assert.equal(reviews[1].motivo, "novo"); assert.equal(reviews[1].tratativa, "nova");
  assert.equal((await query("SELECT sum(custo_usd) AS n FROM custos_ia")).rows[0].n, "4.00000000");
  assert.equal((await query("SELECT count(*) FROM custos_ia WHERE query_log_id IS NULL")).rows[0].count, "2");
  assert.equal((await query("SELECT sql_salvo,query_log_id FROM favoritos")).rows[0].sql_salvo, "SELECT * FROM vw_frota_veiculos");
  assert.equal((await query("SELECT query_log_id FROM favoritos")).rows[0].query_log_id, null);
  assert.deepEqual((await query("SELECT id FROM resultados_teste")).rows.map(r => r.id), [2]);
  assert.equal((await query("SELECT sum(total) AS n FROM execucoes_teste")).rows[0].n, "2");
});
test("second run is idempotent and records only aggregate counts", async () => {
  const r = await limparHistorico({ now, database: isolated });
  assert.ok(Object.values(r.contagens).every(n => n === 0));
  const s = await estadoRetencao(isolated);
  assert.equal(s.ultimaLimpeza, now.toISOString()); assert.equal(s.status, "ok"); assert.equal(s.dias, 90);
  assert.ok(!JSON.stringify(s).includes("pergunta"));
});
test("custom seven-day cutoff and company scoping preserve recent foreign rows", async () => {
  const r = await limparHistorico({ now, days: 7, database: isolated });
  assert.equal(r.contagens.respostas, 2);
  await query("INSERT INTO query_logs(id,empresa_id,created_at,question,answer,freedom_level,latency_ms) VALUES(10,11,$1,'a','a',1,1),(11,22,$1,'b','b',1,1)", [now]);
  await limparHistorico({ now, days: 7, database: isolated });
  assert.deepEqual((await query("SELECT empresa_id FROM query_logs ORDER BY id")).rows.map(r => r.empresa_id), [11, 22]);
});
test("more than one batch completes and a concurrent worker cannot acquire the cleanup lock", async () => {
  await query("INSERT INTO query_logs(id,empresa_id,created_at,question,answer,freedom_level,latency_ms) SELECT i,11,$1,'a','a',1,1 FROM generate_series(100,500) i", [old]);
  const lock = await isolated.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(651590)");
    assert.equal((await limparHistorico({ now, database: isolated })).ignorada, true);
  } finally { await lock.query("SELECT pg_advisory_unlock(651590)"); lock.release(); }
  const r = await limparHistorico({ now, database: isolated });
  assert.equal(r.contagens.respostas, 401);
  assert.equal((await query("SELECT count(*) FROM query_logs")).rows[0].count, "2");
});
test("failure persists status and does not report success or delete parents", async () => {
  await query("ALTER TABLE export_documents RENAME TO temporarily_missing");
  await assert.rejects(limparHistorico({ now, database: isolated }));
  await query("ALTER TABLE temporarily_missing RENAME TO export_documents");
  assert.equal((await estadoRetencao(isolated)).status, "falhou");
  assert.equal((await query("SELECT count(*) FROM query_logs")).rows[0].count, "2");
});
test("health flags failures and delay over 36 hours; daily schedule catches up without traffic", () => {
  assert.equal(alertaRetencao({ status: "ok", ultimaLimpeza: now.toISOString() }, now), "ok");
  assert.equal(alertaRetencao({ status: "falhou", ultimaLimpeza: now.toISOString() }, now), "critico");
  assert.equal(alertaRetencao({ status: "ok", ultimaLimpeza: old.toISOString() }, now), "critico");
  assert.equal(limpezaVencida({ ultimaLimpeza: null, ultimaTentativa: null }, now), true);
  assert.equal(limpezaVencida({ ultimaLimpeza: now.toISOString(), ultimaTentativa: now.toISOString() }, now), false);
  assert.equal(limpezaVencida({ ultimaLimpeza: null, ultimaTentativa: null }, new Date("2026-10-15T05:00:00Z")), false);
});
