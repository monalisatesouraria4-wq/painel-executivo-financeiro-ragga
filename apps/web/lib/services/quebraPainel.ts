import { UNIDADES } from "@painel/shared";
import { variacaoCompraDireta, type SituacaoMotivo } from "@/lib/services/compraDiretaPainel";

/**
 * Análise de Quebra de Caixa por LOJA (REDE → LOJA → OPERADOR / MOTIVO). Tipos e agregação PURA — sem import de
 * banco (usado por componentes client e testes); a consulta do período comparado mora em `quebraPainel.server.ts`.
 *
 * Nenhuma regra de cálculo da Quebra foi alterada: o valor continua sendo a soma de `quebra_caixa.valor` das
 * linhas do período (ciclo 16→15 ou intervalo escolhido, resolvidos pelos serviços existentes de Controles de
 * Caixa). Aqui só se AGREGA: rede = soma das lojas = soma dos operadores (e = soma dos motivos), sem joins que
 * possam duplicar valores. Os motivos são exatamente os da base. Não existe semáforo/meta de Quebra no sistema
 * (nenhum limite foi criado): o "Status/Performance" é a SITUAÇÃO do comparativo — menor = melhorou, maior =
 * piorou, igual = sem alteração (loja/rede pelo % sobre o faturamento; operadores/motivos pelo valor).
 */

export interface LinhaQuebraBruta {
  unidade: string;
  operador: string;
  cpf: string;
  motivo: string;
  valor: number;
}

export interface OperadorQuebra {
  operador: string;
  cpf: string;
  quantidade: number;
  valor: number;
  /** valor do operador ÷ quebra da loja × 100. */
  percentualDaLoja: number;
}

export interface MotivoQuebra {
  motivo: string;
  quantidade: number;
  valor: number;
  /** valor do motivo ÷ quebra do escopo (rede ou loja) × 100. */
  percentualDoTotal: number;
}

export interface LojaQuebra {
  unidade: string;
  faturamento: number;
  valor: number;
  quantidade: number;
  /** quebra ÷ faturamento da loja no mesmo período × 100 (0 quando não há faturamento). */
  percentual: number;
  operadores: OperadorQuebra[];
  motivos: MotivoQuebra[];
}

export interface PeriodoQuebra {
  /** false = nenhum registro de Quebra no período ("Sem dados no período"). */
  disponivel: boolean;
  faturamento: number;
  valor: number;
  quantidade: number;
  percentual: number;
  porLoja: LojaQuebra[];
  motivos: MotivoQuebra[];
}

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

function motivosDe(linhas: LinhaQuebraBruta[]): MotivoQuebra[] {
  const mapa = new Map<string, { quantidade: number; valor: number }>();
  for (const l of linhas) {
    const m = mapa.get(l.motivo) ?? { quantidade: 0, valor: 0 };
    m.quantidade += 1;
    m.valor += l.valor;
    mapa.set(l.motivo, m);
  }
  const total = [...mapa.values()].reduce((s, m) => s + m.valor, 0);
  return [...mapa.entries()]
    .map(([motivo, m]) => ({ motivo, quantidade: m.quantidade, valor: arred(m.valor), percentualDoTotal: total !== 0 ? (m.valor / total) * 100 : 0 }))
    .sort((a, b) => b.valor - a.valor || a.motivo.localeCompare(b.motivo));
}

function operadoresDe(linhas: LinhaQuebraBruta[]): OperadorQuebra[] {
  // Mesma chave (CPF + Operador) já usada no serviço de Controles de Caixa.
  const mapa = new Map<string, OperadorQuebra>();
  for (const l of linhas) {
    const chave = `${l.cpf}||${l.operador}`;
    const o = mapa.get(chave) ?? { operador: l.operador, cpf: l.cpf, quantidade: 0, valor: 0, percentualDaLoja: 0 };
    o.quantidade += 1;
    o.valor += l.valor;
    mapa.set(chave, o);
  }
  const total = [...mapa.values()].reduce((s, o) => s + o.valor, 0);
  return [...mapa.values()]
    .map((o) => ({ ...o, valor: arred(o.valor), percentualDaLoja: total !== 0 ? (o.valor / total) * 100 : 0 }))
    .sort((a, b) => b.valor - a.valor || a.operador.localeCompare(b.operador));
}

/** Agrega as linhas de um período em REDE → LOJA → OPERADOR/MOTIVO, com o % sobre o faturamento de cada loja. */
export function agregarQuebra(linhas: LinhaQuebraBruta[], faturamentoPorLoja: Record<string, number>): PeriodoQuebra {
  const porLojaLinhas = new Map<string, LinhaQuebraBruta[]>();
  for (const l of linhas) {
    const lista = porLojaLinhas.get(l.unidade) ?? [];
    lista.push(l);
    porLojaLinhas.set(l.unidade, lista);
  }
  const codigos = new Set<string>([...porLojaLinhas.keys(), ...Object.keys(faturamentoPorLoja).filter((c) => (faturamentoPorLoja[c] ?? 0) > 0)]);

  const porLoja: LojaQuebra[] = UNIDADES.filter((u) => codigos.has(u)).map((unidade) => {
    const ls = porLojaLinhas.get(unidade) ?? [];
    const faturamento = faturamentoPorLoja[unidade] ?? 0;
    const valor = ls.reduce((s, l) => s + l.valor, 0);
    return {
      unidade,
      faturamento: arred(faturamento),
      valor: arred(valor),
      quantidade: ls.length,
      percentual: faturamento > 0 ? (valor / faturamento) * 100 : 0,
      operadores: operadoresDe(ls),
      motivos: motivosDe(ls),
    };
  });

  const valor = arred(porLoja.reduce((s, l) => s + l.valor, 0));
  const faturamento = arred(porLoja.reduce((s, l) => s + l.faturamento, 0));
  return {
    disponivel: linhas.length > 0,
    faturamento,
    valor,
    quantidade: linhas.length,
    percentual: faturamento > 0 ? (valor / faturamento) * 100 : 0,
    porLoja,
    motivos: motivosDe(linhas),
  };
}

/** Recorte por loja (filtro de loja): mantém só essa loja e recalcula rede/motivos a partir dela. */
export function recortarLoja(periodo: PeriodoQuebra, loja: string | undefined): PeriodoQuebra {
  if (!loja) return periodo;
  const l = periodo.porLoja.find((x) => x.unidade === loja);
  if (!l) return { disponivel: false, faturamento: 0, valor: 0, quantidade: 0, percentual: 0, porLoja: [], motivos: [] };
  return { disponivel: l.quantidade > 0, faturamento: l.faturamento, valor: l.valor, quantidade: l.quantidade, percentual: l.percentual, porLoja: [l], motivos: l.motivos };
}

export type SituacaoQuebra = SituacaoMotivo | "sem-base";

/** Situação do comparativo (menor = melhorou; maior = piorou). `null` = não há base de comparação. */
export function situacaoQuebra(atual: number, comparado: number | null): SituacaoQuebra {
  if (comparado === null) return "sem-base";
  return variacaoCompraDireta(atual, comparado).situacao;
}

export type OrdemQuebra = "loja" | "valor" | "percentual" | "performance";

const PESO_SITUACAO: Record<SituacaoQuebra, number> = { piorou: 3, "sem-alteracao": 2, "sem-base": 1, melhorou: 0 };

/**
 * Ordenação REAL do ranking de lojas. loja: A→Z; valor: maior quebra primeiro; percentual: maior % sobre o
 * faturamento primeiro; performance: piorou → sem alteração → sem base → melhorou (situação do % contra o período
 * comparado) e, dentro de cada grupo, maior piora (p.p.) primeiro.
 */
export function ordenarLojasQuebra(lojas: LojaQuebra[], comparacao: PeriodoQuebra | null, ordem: OrdemQuebra): LojaQuebra[] {
  const compDe = (u: string) => comparacao?.porLoja.find((l) => l.unidade === u) ?? null;
  const pctComp = (u: string): number | null => {
    const c = compDe(u);
    return comparacao && comparacao.disponivel && c ? c.percentual : comparacao && comparacao.disponivel ? 0 : null;
  };
  const delta = (l: LojaQuebra) => {
    const c = pctComp(l.unidade);
    return c === null ? 0 : l.percentual - c;
  };
  return [...lojas].sort((a, b) => {
    switch (ordem) {
      case "loja":
        return a.unidade.localeCompare(b.unidade);
      case "valor":
        return b.valor - a.valor || a.unidade.localeCompare(b.unidade);
      case "percentual":
        return b.percentual - a.percentual || a.unidade.localeCompare(b.unidade);
      default: {
        const sa = situacaoQuebra(a.percentual, pctComp(a.unidade));
        const sb = situacaoQuebra(b.percentual, pctComp(b.unidade));
        return PESO_SITUACAO[sb] - PESO_SITUACAO[sa] || delta(b) - delta(a) || b.percentual - a.percentual || a.unidade.localeCompare(b.unidade);
      }
    }
  });
}

/** Resposta da ação de servidor: dados do período COMPARADO e faturamento por loja dos dois períodos. */
export interface QuebraComparativoDados {
  conectado: boolean;
  faturamentoAtual: Record<string, number>;
  comparacao: { linhas: LinhaQuebraBruta[]; faturamento: Record<string, number> };
  /** Primeira data com registro na base de Quebra (AAAA-MM-DD) — para avisar quando o período comparado é parcial. */
  quebraDesde: string | null;
}
