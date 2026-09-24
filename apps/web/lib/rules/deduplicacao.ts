import type { TipoBase } from "@painel/shared";
import { TIPOS_BASE_SEM_DEDUP } from "@painel/shared";

export type EstrategiaGravacao = "upsert_por_chave" | "delete_periodo_insert";

/**
 * Define, por tipo de base, a estratégia de gravação na reimportação
 * (planejamento, "REGRAS IMPORTANTES" e "REGRAS DE NEGÓCIO COMO CÓDIGO
 * CENTRALIZADO"). Único ponto de decisão — não duplicar em outras camadas.
 */
export function estrategiaGravacao(tipoBase: TipoBase): EstrategiaGravacao {
  return TIPOS_BASE_SEM_DEDUP.includes(tipoBase)
    ? "delete_periodo_insert"
    : "upsert_por_chave";
}
