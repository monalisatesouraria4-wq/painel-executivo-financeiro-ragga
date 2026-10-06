import { UNIDADES } from "@painel/shared";

/**
 * Camada gerencial de "Retirada para Depósito": cards, ranking por loja e comparativo com o período anterior.
 * Módulo PURO (sem banco): só AGREGA as linhas que `buscarRetiradaDepositoPersonalizado` já devolve para o período
 * selecionado e para o período anterior — a regra financeira dos registros (motivo DEPÓSITO, soma por ciclo) não é
 * alterada, e nada é inventado: lojas e valores vêm exclusivamente da base de Retirada para Depósito.
 *
 * - Total da loja no período = Σ `retiradaCiclo` das linhas da loja (cada linha = um ciclo, já somado por inteiro dentro
 *   do período; somar os ciclos de UMA loja dentro do MESMO período é o total retirado no período).
 * - Período anterior = mesma duração, imediatamente antes do início do período selecionado.
 * - Variação % só existe quando há base anterior (> 0): sem base anterior nunca se calcula percentual "infinito".
 */

const MS_DIA = 86_400_000;
const TOLERANCIA = 0.005;
const arred = (v: number) => Math.round(v * 100) / 100;

/** Período imediatamente anterior, de MESMA duração (em dias corridos, inclusivo nas duas pontas). */
export function periodoAnteriorMesmaDuracao(inicio: Date, fim: Date): { inicio: Date; fim: Date; dias: number } {
  const dias = Math.round((fim.getTime() - inicio.getTime()) / MS_DIA) + 1;
  const fimAnterior = new Date(inicio.getTime() - MS_DIA);
  const inicioAnterior = new Date(fimAnterior.getTime() - (dias - 1) * MS_DIA);
  return { inicio: inicioAnterior, fim: fimAnterior, dias };
}

export interface LinhaDepositoBruta {
  unidade: string;
  retiradaCiclo: number;
}

export type SituacaoRetiradaLoja = "aumentou" | "reduziu" | "estavel" | "sem-base-anterior";

export interface LojaRetiradaGerencial {
  unidade: string;
  atual: number;
  anterior: number;
  /** atual − anterior (R$). */
  diferenca: number;
  /** (atual − anterior) ÷ anterior × 100; `null` quando não há base anterior (anterior = 0). */
  variacaoPercentual: number | null;
  situacao: SituacaoRetiradaLoja;
}

export interface DepositoGerencial {
  totalAtual: number;
  totalAnterior: number;
  /** lojas DISTINTAS com retirada (> 0) no período atual. */
  lojasComRetirada: number;
  /** totalAtual ÷ lojasComRetirada (0 quando não há lojas com retirada). */
  mediaPorLoja: number;
  /** variação do total contra o período anterior; `null` quando o total anterior é 0 (sem base). */
  variacaoTotalPercentual: number | null;
  /** Todas as lojas com retirada no atual OU no anterior — ordem: maior retirada atual; empate: maior diferença em R$. */
  lojas: LojaRetiradaGerencial[];
  /** 5 maiores aumentos percentuais (só lojas com base anterior e aumento). */
  pontosDeAtencao: LojaRetiradaGerencial[];
  /** Lojas com retirada atual e SEM base anterior (variação % não calculada) — listadas à parte. */
  semBaseAnterior: LojaRetiradaGerencial[];
}

export function totaisPorLoja(linhas: LinhaDepositoBruta[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of linhas) m.set(l.unidade, (m.get(l.unidade) ?? 0) + l.retiradaCiclo);
  return m;
}

function situacaoDe(atual: number, anterior: number): SituacaoRetiradaLoja {
  if (anterior <= TOLERANCIA) return "sem-base-anterior";
  const delta = atual - anterior;
  if (Math.abs(delta) < TOLERANCIA) return "estavel";
  return delta > 0 ? "aumentou" : "reduziu";
}

export function montarDepositoGerencial(atualLinhas: LinhaDepositoBruta[], anteriorLinhas: LinhaDepositoBruta[]): DepositoGerencial {
  const atualMapa = totaisPorLoja(atualLinhas);
  const anteriorMapa = totaisPorLoja(anteriorLinhas);
  const ordemOficial = new Map<string, number>(UNIDADES.map((u, i) => [u as string, i]));

  const codigos = new Set<string>([...atualMapa.keys(), ...anteriorMapa.keys()]);
  const lojas: LojaRetiradaGerencial[] = [...codigos]
    .map((unidade) => {
      const atual = arred(atualMapa.get(unidade) ?? 0);
      const anterior = arred(anteriorMapa.get(unidade) ?? 0);
      return {
        unidade,
        atual,
        anterior,
        diferenca: arred(atual - anterior),
        variacaoPercentual: anterior > TOLERANCIA ? ((atual - anterior) / anterior) * 100 : null,
        situacao: situacaoDe(atual, anterior),
      };
    })
    .filter((l) => l.atual > TOLERANCIA || l.anterior > TOLERANCIA)
    .sort((a, b) => b.atual - a.atual || b.diferenca - a.diferenca || (ordemOficial.get(a.unidade) ?? 99) - (ordemOficial.get(b.unidade) ?? 99));

  const totalAtual = arred(lojas.reduce((s, l) => s + l.atual, 0));
  const totalAnterior = arred(lojas.reduce((s, l) => s + l.anterior, 0));
  const lojasComRetirada = lojas.filter((l) => l.atual > TOLERANCIA).length;

  return {
    totalAtual,
    totalAnterior,
    lojasComRetirada,
    mediaPorLoja: lojasComRetirada > 0 ? arred(totalAtual / lojasComRetirada) : 0,
    variacaoTotalPercentual: totalAnterior > TOLERANCIA ? ((totalAtual - totalAnterior) / totalAnterior) * 100 : null,
    lojas,
    pontosDeAtencao: lojas
      .filter((l) => l.situacao === "aumentou")
      .sort((a, b) => (b.variacaoPercentual ?? 0) - (a.variacaoPercentual ?? 0) || b.diferenca - a.diferenca)
      .slice(0, 5),
    semBaseAnterior: lojas.filter((l) => l.situacao === "sem-base-anterior" && l.atual > TOLERANCIA),
  };
}
