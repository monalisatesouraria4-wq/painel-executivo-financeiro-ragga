import { UNIDADES } from "@painel/shared";
import type { PdvMaquininhaLinha } from "@/lib/services/controlesCaixa";

/**
 * Camada gerencial de PDV × Maquininha: ranking de lojas por divergência, pontos de atenção e comparação da divergência
 * da rede com o período anterior. Módulo PURO: só agrega as linhas que a aba já carrega (`PdvMaquininhaLinha`: total PDV,
 * total Maquininha e diferença por loja) — nenhuma regra financeira alterada.
 *
 * - Diferença = Maquininha − PDV (COM sinal): negativa = maquininha abaixo do PDV (falta); positiva = acima (sobra).
 * - % de divergência = Diferença ÷ Total PDV × 100, com o sinal da diferença; `null` sem Total PDV.
 * - Gravidade = |diferença| (o sinal é mantido na exibição). Divergente = |diferença| > 0,005 (tolerância já existente na aba).
 * - Loja sem movimentação (PDV = 0 e Maquininha = 0) não entra no ranking nem é problema.
 * - Rede = Σ lojas (nunca recalculada de outra fonte).
 */

export const TOLERANCIA_DIVERGENCIA = 0.005;
const arred = (v: number) => Math.round(v * 100) / 100;

export type SentidoDivergencia = "falta" | "sobra" | "sem-diferenca";

export interface LojaDivergenciaPdv {
  unidade: string;
  totalPdv: number;
  totalMaquininha: number;
  /** Maquininha − PDV, com sinal. */
  diferenca: number;
  /** Diferença ÷ Total PDV × 100 (com sinal); `null` quando o Total PDV é zero. */
  percentual: number | null;
  sentido: SentidoDivergencia;
}

export interface ResumoRedePdv {
  totalPdv: number;
  totalMaquininha: number;
  diferenca: number;
  percentual: number | null;
}

export interface ComparacaoDivergenciaPdv {
  /** false = o período anterior não tem nenhuma loja com movimentação (sem base de comparação). */
  temBase: boolean;
  atual: ResumoRedePdv;
  anterior: ResumoRedePdv | null;
  /** |divergência atual| − |divergência anterior| (R$): positivo = a divergência AUMENTOU; negativo = diminuiu. */
  variacaoReais: number | null;
  /** variação acima ÷ |divergência anterior| × 100; `null` sem base ou quando a divergência anterior foi zero. */
  variacaoPercentual: number | null;
  /** Variação do % de divergência (em módulo), em pontos percentuais; `null` sem base. */
  variacaoPp: number | null;
}

export interface PdvGerencial {
  rede: ResumoRedePdv;
  /** Lojas com movimentação, da maior divergência em valor absoluto para a menor. */
  lojas: LojaDivergenciaPdv[];
  /** Até 5 lojas com divergência relevante (|diferença| acima da tolerância), maior valor absoluto primeiro. */
  pontosDeAtencao: LojaDivergenciaPdv[];
  comparacao: ComparacaoDivergenciaPdv;
}

export function sentidoDe(diferenca: number): SentidoDivergencia {
  if (Math.abs(diferenca) <= TOLERANCIA_DIVERGENCIA) return "sem-diferenca";
  return diferenca < 0 ? "falta" : "sobra";
}

function teveMovimento(l: Pick<PdvMaquininhaLinha, "totalPdv" | "totalMaquininha">): boolean {
  return Math.abs(l.totalPdv) > TOLERANCIA_DIVERGENCIA || Math.abs(l.totalMaquininha) > TOLERANCIA_DIVERGENCIA;
}

function agruparLojas(linhas: PdvMaquininhaLinha[]): LojaDivergenciaPdv[] {
  const mapa = new Map<string, { pdv: number; maq: number }>();
  for (const l of linhas) {
    if (!teveMovimento(l)) continue;
    const a = mapa.get(l.unidade) ?? { pdv: 0, maq: 0 };
    a.pdv += l.totalPdv;
    a.maq += l.totalMaquininha;
    mapa.set(l.unidade, a);
  }
  return [...mapa.entries()].map(([unidade, v]) => {
    const totalPdv = arred(v.pdv);
    const totalMaquininha = arred(v.maq);
    const diferenca = arred(totalMaquininha - totalPdv);
    return { unidade, totalPdv, totalMaquininha, diferenca, percentual: totalPdv !== 0 ? (diferenca / totalPdv) * 100 : null, sentido: sentidoDe(diferenca) };
  });
}

function resumirRede(lojas: LojaDivergenciaPdv[]): ResumoRedePdv {
  const totalPdv = arred(lojas.reduce((s, l) => s + l.totalPdv, 0));
  const totalMaquininha = arred(lojas.reduce((s, l) => s + l.totalMaquininha, 0));
  const diferenca = arred(totalMaquininha - totalPdv);
  return { totalPdv, totalMaquininha, diferenca, percentual: totalPdv !== 0 ? (diferenca / totalPdv) * 100 : null };
}

export function montarPdvGerencial(atualLinhas: PdvMaquininhaLinha[], anteriorLinhas: PdvMaquininhaLinha[] | null): PdvGerencial {
  const ordemOficial = new Map<string, number>(UNIDADES.map((u, i) => [u as string, i]));
  const lojas = agruparLojas(atualLinhas).sort(
    (a, b) =>
      Math.abs(b.diferenca) - Math.abs(a.diferenca) ||
      Math.abs(b.percentual ?? 0) - Math.abs(a.percentual ?? 0) ||
      (ordemOficial.get(a.unidade) ?? 99) - (ordemOficial.get(b.unidade) ?? 99)
  );
  const rede = resumirRede(lojas);

  const lojasAnterior = anteriorLinhas ? agruparLojas(anteriorLinhas) : [];
  const temBase = lojasAnterior.length > 0;
  const anterior = temBase ? resumirRede(lojasAnterior) : null;
  const absAnterior = anterior ? Math.abs(anterior.diferenca) : 0;
  const variacaoReais = anterior ? arred(Math.abs(rede.diferenca) - absAnterior) : null;

  return {
    rede,
    lojas,
    pontosDeAtencao: lojas.filter((l) => l.sentido !== "sem-diferenca").slice(0, 5),
    comparacao: {
      temBase,
      atual: rede,
      anterior,
      variacaoReais,
      variacaoPercentual: variacaoReais !== null && absAnterior > TOLERANCIA_DIVERGENCIA ? (variacaoReais / absAnterior) * 100 : null,
      variacaoPp: anterior && rede.percentual !== null && anterior.percentual !== null ? Math.abs(rede.percentual) - Math.abs(anterior.percentual) : null,
    },
  };
}
