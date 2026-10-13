import type { FastifyInstance } from "fastify";
import { currentFicha } from "../lib/ficha";
import { currentPool, currentCompanyId, currentTenant } from "../lib/tenant";
import { companyInterval, lastLoads, readHealth, worst, type Estado } from "../lib/saude-dados";

const MESSAGE: Record<Estado, string> = {
  em_dia: "Os dados estão em dia.",
  atencao: "Os dados estão começando a ficar velhos. Confira se a próxima carga vai rodar.",
  desatualizado: "Os dados estão desatualizados: as respostas podem não refletir o que aconteceu nos últimos dias.",
  sem_dados: "Ainda não há dados carregados.",
};

/** How fresh the data behind the answers is: when each mirror table was loaded, how recent each described view is, and how the last loads went. */
export async function saudeRoutes(app: FastifyInstance) {
  app.get("/saude", async () => {
    const companyId = currentCompanyId();
    const intervalo = await companyInterval(companyId);
    const cargas = (await lastLoads(companyId)).map(r => ({ id: r.id, modo: r.mode, disparo: r.trigger, status: r.status, ok: r.ok, erro: r.error, iniciadaEm: r.startedAt.toISOString(), concluidaEm: r.finishedAt?.toISOString() ?? null }));
    const ready = companyId === 1 || Boolean(currentTenant()?.data);
    if (!ready) return { estado: "sem_dados" as Estado, mensagem: "A base desta empresa ainda não foi conectada.", demonstracao: false, intervaloMin: intervalo, tabelas: [], visoes: [], cargas };
    const { tabelas, visoes } = await readHealth(currentPool(), currentFicha(), intervalo);
    const lastOk = cargas.find(c => c.ok === true);
    const failedSince = cargas[0] && cargas[0].ok === false;
    // The state is the worst of the views (what the manager actually reads); the mirror tables explain why.
    const base: Estado[] = [...visoes.map(v => v.estado), ...tabelas.map(t => t.estado)];
    let estado = base.length ? worst(base) : "sem_dados";
    if (failedSince && estado === "em_dia") estado = "atencao";
    // The demonstration keeps a fixed reference date by design, so its age is not a problem to report.
    const demonstracao = companyId === 1;
    if (demonstracao) estado = "em_dia";
    return {
      estado, mensagem: demonstracao ? "Base de demonstração: os dados são fixos e não recebem cargas." : failedSince ? `${MESSAGE[estado]} A última carga falhou.` : MESSAGE[estado],
      demonstracao, intervaloMin: intervalo, ultimaCargaOkEm: lastOk?.concluidaEm ?? null, tabelas, visoes, cargas,
    };
  });
}
