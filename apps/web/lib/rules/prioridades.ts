import { FAIXAS_BRINDES, FAIXAS_CANCELAMENTO, FAIXAS_COMPRA_DIRETA, type CorSemaforo, type FaixaSemaforo } from "@/lib/rules/semaforos";
import type { LinhaDetalhamentoLoja } from "@/lib/services/visaoGeral";

/**
 * Pontos de Atenção e ordenação por criticidade da Visão Geral.
 *
 * NÃO existe nota/score nem meta nova: usa exclusivamente o semáforo que
 * já vem calculado em cada indicador (`FAIXAS_*` de `semaforos.ts`; Brindes
 * já considera só os controláveis). Indicadores de performance:
 * Brindes, Compra Direta, Cancelamento Salão e Cancelamento Delivery.
 */

export type ChaveIndicadorPerformance = "brindes" | "retiradaCompraDireta" | "cancelamentoSalao" | "cancelamentoDelivery";

export const INDICADORES_PERFORMANCE: { chave: ChaveIndicadorPerformance; rotulo: string; faixas: FaixaSemaforo[] }[] = [
  { chave: "brindes", rotulo: "Brindes (controláveis)", faixas: FAIXAS_BRINDES },
  { chave: "retiradaCompraDireta", rotulo: "Compra Direta", faixas: FAIXAS_COMPRA_DIRETA },
  { chave: "cancelamentoSalao", rotulo: "Cancelamento Salão", faixas: FAIXAS_CANCELAMENTO },
  { chave: "cancelamentoDelivery", rotulo: "Cancelamento Delivery", faixas: FAIXAS_CANCELAMENTO },
];

const ROTULO_CURTO: Record<ChaveIndicadorPerformance, string> = {
  brindes: "Brindes",
  retiradaCompraDireta: "Compra Direta",
  cancelamentoSalao: "Cancel. Salão",
  cancelamentoDelivery: "Cancel. Delivery",
};

const PESO: Record<CorSemaforo, number> = { vermelho: 2, amarelo: 1, verde: 0, azul: 0 };

export interface PontoAtencao {
  unidade: string;
  criticos: number;
  atencao: number;
  /** Indicadores responsáveis pelo status (críticos primeiro). */
  indicadores: IndicadorDoPonto[];
}

/** Indicador que gera a classificação da loja, com os dados para a explicação (expansão do card). */
export interface IndicadorDoPonto {
  /** Rótulo curto (linha compacta do card). */
  rotulo: string;
  /** Nome completo do indicador (detalhe expandido). */
  nome: string;
  semaforo: "amarelo" | "vermelho";
  valor: number;
  percentual: number;
  /** Limite máximo da faixa saudável (azul/verde) já existente — referência, não meta nova. */
  limite: number;
  /** Distância em pontos percentuais acima do limite saudável. */
  distanciaPp: number;
}

/** Último limite superior das faixas azul/verde (início da zona de atenção) — referência de desvio, não meta nova. */
export function limiteSaudavel(faixas: FaixaSemaforo[]): number {
  let limite = 0;
  for (const f of faixas) if (f.cor === "azul" || f.cor === "verde") limite = f.ateInclusive;
  return limite;
}

/**
 * PONTOS DE ATENÇÃO — TOP N LOJAS (cada unidade é independente, nada é agrupado) que
 * concentram indicadores em Atenção/Crítico. Ordem: mais críticos, depois mais em
 * atenção; empate: maior desvio percentual (percentual ÷ limite saudável, entre os
 * indicadores fora do limite da loja), depois nome. Sem score nem meta nova.
 */
export function calcularPontosAtencao(linhas: LinhaDetalhamentoLoja[], topN = 5): PontoAtencao[] {
  const itens: (PontoAtencao & { maiorDesvio: number })[] = [];
  for (const linha of linhas) {
    const fora: (IndicadorDoPonto & { razao: number })[] = [];
    for (const ind of INDICADORES_PERFORMANCE) {
      const dado = linha[ind.chave];
      if (!dado.disponivel || dado.percentualFaturamento === undefined) continue;
      if (dado.semaforo !== "vermelho" && dado.semaforo !== "amarelo") continue;
      const limite = limiteSaudavel(ind.faixas);
      fora.push({
        rotulo: ROTULO_CURTO[ind.chave],
        nome: ind.rotulo,
        semaforo: dado.semaforo,
        valor: dado.valor ?? 0,
        percentual: dado.percentualFaturamento,
        limite,
        distanciaPp: dado.percentualFaturamento - limite,
        razao: limite > 0 ? dado.percentualFaturamento / limite : dado.percentualFaturamento,
      });
    }
    if (fora.length === 0) continue;
    fora.sort((x, y) => PESO[y.semaforo] - PESO[x.semaforo] || y.razao - x.razao);
    itens.push({
      unidade: linha.unidade,
      criticos: fora.filter((f) => f.semaforo === "vermelho").length,
      atencao: fora.filter((f) => f.semaforo === "amarelo").length,
      indicadores: fora.map((f) => ({ rotulo: f.rotulo, nome: f.nome, semaforo: f.semaforo, valor: f.valor, percentual: f.percentual, limite: f.limite, distanciaPp: f.distanciaPp })),
      maiorDesvio: Math.max(...fora.map((f) => f.razao)),
    });
  }
  itens.sort(
    (a, b) => b.criticos - a.criticos || b.atencao - a.atencao || b.maiorDesvio - a.maiorDesvio || a.unidade.localeCompare(b.unidade)
  );
  return itens.slice(0, topN).map((item) => ({
    unidade: item.unidade,
    criticos: item.criticos,
    atencao: item.atencao,
    indicadores: item.indicadores,
  }));
}

/** Contagem de indicadores críticos/atenção da loja (sem nota artificial). */
export function contarCriticidade(linha: LinhaDetalhamentoLoja): { criticos: number; atencao: number } {
  let criticos = 0;
  let atencao = 0;
  for (const ind of INDICADORES_PERFORMANCE) {
    const dado = linha[ind.chave];
    if (!dado.disponivel) continue;
    if (dado.semaforo === "vermelho") criticos++;
    else if (dado.semaforo === "amarelo") atencao++;
  }
  return { criticos, atencao };
}

/** Maior criticidade primeiro: mais indicadores críticos, depois mais em atenção, depois nome da loja. */
export function compararCriticidade(a: LinhaDetalhamentoLoja, b: LinhaDetalhamentoLoja): number {
  const ca = contarCriticidade(a);
  const cb = contarCriticidade(b);
  return cb.criticos - ca.criticos || cb.atencao - ca.atencao || a.unidade.localeCompare(b.unidade);
}
