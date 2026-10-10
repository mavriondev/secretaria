import { ERP_CONFIG } from "./erp-config";

/** Read views over the demonstration fleet tables, filtered by company like the sales views. */
export const FLEET_VIEWS = ["vw_frota_veiculos", "vw_frota_viagens", "vw_frota_ocorrencias"] as const;
export function fleetViewsSql(): string {
  const company = Number(ERP_CONFIG.companyCode);
  if (!Number.isInteger(company)) throw new Error("Invalid company code");
  return `
    CREATE OR REPLACE VIEW public.vw_frota_veiculos AS
    SELECT id AS veiculo_id, placa, descricao, tipo, capacidade_kg, situacao, observacao, atualizado_em
    FROM frota_veiculos WHERE empresa = ${company};

    CREATE OR REPLACE VIEW public.vw_frota_viagens AS
    SELECT v.id AS viagem_id, v.veiculo_id, c.placa, v.saida_em, v.retorno_em, v.destino, v.carga_kg, v.entrega, v.observacao,
           c.atualizado_em AS atualizado_em
    FROM frota_viagens v JOIN frota_veiculos c ON c.id = v.veiculo_id
    WHERE v.empresa = ${company};

    CREATE OR REPLACE VIEW public.vw_frota_ocorrencias AS
    SELECT o.id AS ocorrencia_id, o.veiculo_id, c.placa, o.tipo, o.inicio_em, o.fim_em, o.descricao,
           c.atualizado_em AS atualizado_em
    FROM frota_ocorrencias o JOIN frota_veiculos c ON c.id = o.veiculo_id
    WHERE o.empresa = ${company};
  `;
}
