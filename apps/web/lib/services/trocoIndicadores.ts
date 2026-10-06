import { UNIDADES } from "@painel/shared";
import type { TrocoCaixaLinha, TrocoLinha } from "@/lib/services/controlesCaixa";

/**
 * Indicadores do Troco (classificação feita só na camada de cálculo/apresentação — nenhum dado é alterado):
 *
 * - `diferenca` = troco conferido pelo gerente − troco informado pelo colaborador (mesma subtração da planilha).
 * - "Sem valor de conferência registrado": conferido = 0 E informado = 0. A base NÃO tem um campo explícito de
 *   "conferência realizada"; o par 0/0 é um marcador operacional INFERIDO da estrutura (nunca é prova de que a
 *   conferência não aconteceu — por isso o texto da tela não diz "conferência não realizada").
 * - "Conferido": conferido ≠ 0 E informado ≠ 0 E diferença = 0.
 * - "Divergência": diferença ≠ 0. Falta = diferença negativa (é o valor que, em tese, vai para a Quebra); sobra =
 *   diferença positiva (nunca entra no valor de falta/ranking de faltas).
 * - `plano_de_acao` é texto livre: serve só para indicar que EXISTE um plano de quebra registrado, nunca como valor
 *   financeiro estruturado — o valor da falta e o valor "com plano de quebra registrado" são mostrados separados.
 */

const TOLERANCIA = 0.005;
const arred = (v: number) => Math.round(v * 100) / 100;

export type CaixaTrocoLoja = TrocoCaixaLinha & { unidade: string };

/** Achata `TrocoLinha[]` (loja → caixas) em caixas com a loja anexada. */
export function caixasComLoja(linhas: TrocoLinha[]): CaixaTrocoLoja[] {
  return linhas.flatMap((l) => l.caixas.map((c) => ({ ...c, unidade: l.unidade as string })));
}

export type ClasseTroco = "sem-valor" | "conferido" | "divergencia";

export const ROTULO_SEM_VALOR_CONFERENCIA = "Sem valor de conferência registrado";

export function ehCaixaSemConferencia(c: Pick<TrocoCaixaLinha, "conferido" | "informado">): boolean {
  return Math.abs(c.conferido) < TOLERANCIA && Math.abs(c.informado) < TOLERANCIA;
}

/** Classe do caixa: 0/0 primeiro (nunca conta como conferido); depois divergência; senão conferido. */
export function classificarCaixaTroco(c: Pick<TrocoCaixaLinha, "conferido" | "informado" | "diferenca">): ClasseTroco {
  if (ehCaixaSemConferencia(c)) return "sem-valor";
  if (Math.abs(c.diferenca) >= TOLERANCIA) return "divergencia";
  return "conferido";
}

export function resumirTrocoQuebraEConferencia(caixas: Pick<TrocoCaixaLinha, "conferido" | "informado" | "diferenca">[]) {
  const faltas = caixas.filter((c) => c.diferenca < -TOLERANCIA);
  const sobras = caixas.filter((c) => c.diferenca > TOLERANCIA);
  return {
    /** Σ |diferença| das faltas (valor positivo = valor da falta). */
    valorEncaminhadoParaQuebra: arred(faltas.reduce((s, c) => s - c.diferenca, 0)),
    caixasComFalta: faltas.length,
    caixasComSobra: sobras.length,
    caixasSemConferencia: caixas.filter(ehCaixaSemConferencia).length,
  };
}

/** Plano de ação de quebra registrado (texto livre menciona "quebra"). Só faz sentido para faltas. */
export function temPlanoDeQuebra(c: Pick<TrocoCaixaLinha, "planoDeAcao">): boolean {
  return /quebra/i.test(c.planoDeAcao ?? "");
}

export interface ResumoTroco {
  total: number;
  conferidos: number;
  semValor: number;
  divergencias: number;
  faltas: { quantidade: number; valor: number };
  sobras: { quantidade: number; valor: number };
  /** Faltas com plano de ação mencionando quebra (subconjunto das faltas; texto livre, não é lançamento financeiro). */
  faltasComPlanoDeQuebra: { quantidade: number; valor: number };
}

export function resumirTroco(caixas: Pick<TrocoCaixaLinha, "conferido" | "informado" | "diferenca" | "planoDeAcao">[]): ResumoTroco {
  const classes = caixas.map(classificarCaixaTroco);
  const faltas = caixas.filter((c) => c.diferenca < -TOLERANCIA);
  const sobras = caixas.filter((c) => c.diferenca > TOLERANCIA);
  const comPlano = faltas.filter(temPlanoDeQuebra);
  return {
    total: caixas.length,
    conferidos: classes.filter((c) => c === "conferido").length,
    semValor: classes.filter((c) => c === "sem-valor").length,
    divergencias: classes.filter((c) => c === "divergencia").length,
    faltas: { quantidade: faltas.length, valor: arred(faltas.reduce((s, c) => s - c.diferenca, 0)) },
    sobras: { quantidade: sobras.length, valor: arred(sobras.reduce((s, c) => s + c.diferenca, 0)) },
    faltasComPlanoDeQuebra: { quantidade: comPlano.length, valor: arred(comPlano.reduce((s, c) => s - c.diferenca, 0)) },
  };
}

export interface LinhaRankingFaltas {
  unidade: string;
  valorFalta: number;
  ocorrencias: number;
}

/** Maiores faltas por loja (só diferença negativa; sobras ficam de fora). Ordem: maior falta financeira primeiro. */
export function rankingFaltasPorLoja(caixas: CaixaTrocoLoja[]): LinhaRankingFaltas[] {
  const mapa = new Map<string, LinhaRankingFaltas>();
  for (const c of caixas) {
    if (c.diferenca >= -TOLERANCIA) continue;
    const l = mapa.get(c.unidade) ?? { unidade: c.unidade, valorFalta: 0, ocorrencias: 0 };
    l.valorFalta += -c.diferenca;
    l.ocorrencias += 1;
    mapa.set(c.unidade, l);
  }
  return [...mapa.values()]
    .map((l) => ({ ...l, valorFalta: arred(l.valorFalta) }))
    .sort((a, b) => b.valorFalta - a.valorFalta || b.ocorrencias - a.ocorrencias || a.unidade.localeCompare(b.unidade));
}

export type TipoSemValor = "loja-inteira" | "caixa-isolado";

export const ROTULO_TIPO_SEM_VALOR: Record<TipoSemValor, string> = {
  "loja-inteira": "Loja inteira sem valor de conferência",
  "caixa-isolado": "Caixa isolado sem valor de conferência",
};

const chaveLojaData = (c: { unidade: string; data: Date }) => `${c.unidade}|${c.data.toISOString().slice(0, 10)}`;

/**
 * Para cada loja/data: se TODOS os caixas daquela loja/data são 0/0 → "loja inteira"; se só parte → "caixa isolado".
 * Serve de apoio à análise; não altera nenhuma contagem.
 */
export function tipoSemValorPorLojaData(caixas: CaixaTrocoLoja[]): Map<string, TipoSemValor> {
  const grupos = new Map<string, { total: number; zeros: number }>();
  for (const c of caixas) {
    const g = grupos.get(chaveLojaData(c)) ?? { total: 0, zeros: 0 };
    g.total += 1;
    if (ehCaixaSemConferencia(c)) g.zeros += 1;
    grupos.set(chaveLojaData(c), g);
  }
  const out = new Map<string, TipoSemValor>();
  for (const [k, g] of grupos) if (g.zeros > 0) out.set(k, g.zeros === g.total ? "loja-inteira" : "caixa-isolado");
  return out;
}

export function tipoSemValorDoCaixa(c: CaixaTrocoLoja, tipos: Map<string, TipoSemValor>): TipoSemValor | null {
  return ehCaixaSemConferencia(c) ? (tipos.get(chaveLojaData(c)) ?? null) : null;
}

export interface LinhaLojaSemValor {
  unidade: string;
  semValor: number;
  total: number;
  percentual: number;
  /** Dos caixas sem valor da loja: quantos estão em loja/data inteira zerada e quantos são caixa isolado. */
  caixasEmLojaInteira: number;
  caixasIsolados: number;
}

/**
 * Lojas com registros 0/0. Ordem: MAIOR QUANTIDADE de caixas sem valor (é o que mais pesa na gestão da conferência),
 * desempate pelo maior percentual e depois pela loja.
 */
export function lojasSemValorDeConferencia(caixas: CaixaTrocoLoja[]): LinhaLojaSemValor[] {
  const tipos = tipoSemValorPorLojaData(caixas);
  const mapa = new Map<string, LinhaLojaSemValor>();
  for (const c of caixas) {
    const l = mapa.get(c.unidade) ?? { unidade: c.unidade, semValor: 0, total: 0, percentual: 0, caixasEmLojaInteira: 0, caixasIsolados: 0 };
    l.total += 1;
    if (ehCaixaSemConferencia(c)) {
      l.semValor += 1;
      if (tipoSemValorDoCaixa(c, tipos) === "loja-inteira") l.caixasEmLojaInteira += 1;
      else l.caixasIsolados += 1;
    }
    mapa.set(c.unidade, l);
  }
  const ordemOficial = new Map<string, number>(UNIDADES.map((u, i) => [u as string, i]));
  return [...mapa.values()]
    .filter((l) => l.semValor > 0)
    .map((l) => ({ ...l, percentual: l.total > 0 ? (l.semValor / l.total) * 100 : 0 }))
    .sort((a, b) => b.semValor - a.semValor || b.percentual - a.percentual || (ordemOficial.get(a.unidade) ?? 99) - (ordemOficial.get(b.unidade) ?? 99));
}
