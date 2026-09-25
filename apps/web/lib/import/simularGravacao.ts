import type { TipoBase } from "@painel/shared";
import { estrategiaGravacao } from "../rules/deduplicacao";
import { CHAVES_POR_BASE } from "../rules/chaves";
import type { RegistroBase } from "./tipos";

export interface ResultadoGravacaoSimulada {
  estrategia: "upsert_por_chave" | "delete_periodo_insert";
  inseridos: number;
  atualizados: number;
  /** Só se aplica a delete_periodo_insert: registros do período removidos antes do insert. */
  removidosDoPeriodo: number;
  /** Registros existentes fora do período importado — nunca tocados. */
  preservadosForaDoPeriodo: number;
  totalFinal: number;
}

function chaveDoRegistro(registro: RegistroBase, camposChave: readonly string[]): string {
  const partes = camposChave.map((campo) => {
    if (campo === "unidade_id") return registro.unidade;
    if (campo === "data") return registro.data.toISOString().slice(0, 10);
    return registro.extras[campo] ?? "";
  });
  return partes.join("||");
}

/**
 * Simula o efeito de gravar `registrosNovos` dado um `estadoExistente`
 * simulado (sem tocar em banco real — Etapa 3 roda só local/teste).
 * Implementa exatamente as duas estratégias definidas em
 * lib/rules/deduplicacao.ts: upsert por chave, ou delete do período +
 * insert (preservando duplicidades legítimas e períodos anteriores).
 */
export function simularGravacao(
  tipoBase: TipoBase,
  registrosNovos: RegistroBase[],
  estadoExistente: RegistroBase[]
): ResultadoGravacaoSimulada {
  const estrategia = estrategiaGravacao(tipoBase);

  if (estrategia === "upsert_por_chave") {
    const camposChave = CHAVES_POR_BASE[tipoBase];
    const existentesPorChave = new Map(
      estadoExistente.map((r) => [chaveDoRegistro(r, camposChave), r])
    );
    const chavesNovas = new Set<string>();
    let atualizados = 0;
    let inseridos = 0;

    for (const registro of registrosNovos) {
      const chave = chaveDoRegistro(registro, camposChave);
      if (chavesNovas.has(chave)) continue; // última ocorrência no arquivo vence, já contada
      chavesNovas.add(chave);
      if (existentesPorChave.has(chave)) atualizados += 1;
      else inseridos += 1;
    }

    const totalFinal = new Set([...existentesPorChave.keys(), ...chavesNovas]).size;

    return {
      estrategia,
      inseridos,
      atualizados,
      removidosDoPeriodo: 0,
      preservadosForaDoPeriodo: estadoExistente.length - atualizados,
      totalFinal,
    };
  }

  // delete_periodo_insert: remove apenas o período coberto pelos registros
  // novos; preserva duplicidades legítimas e tudo fora do período.
  if (registrosNovos.length === 0) {
    return {
      estrategia,
      inseridos: 0,
      atualizados: 0,
      removidosDoPeriodo: 0,
      preservadosForaDoPeriodo: estadoExistente.length,
      totalFinal: estadoExistente.length,
    };
  }

  const tempos = registrosNovos.map((r) => r.data.getTime());
  const periodoInicio = Math.min(...tempos);
  const periodoFim = Math.max(...tempos);

  const removidosDoPeriodo = estadoExistente.filter(
    (r) => r.data.getTime() >= periodoInicio && r.data.getTime() <= periodoFim
  ).length;
  const preservadosForaDoPeriodo = estadoExistente.length - removidosDoPeriodo;

  return {
    estrategia,
    inseridos: registrosNovos.length,
    atualizados: 0,
    removidosDoPeriodo,
    preservadosForaDoPeriodo,
    totalFinal: preservadosForaDoPeriodo + registrosNovos.length,
  };
}
