import { UNIDADES } from "@painel/shared";
import { classificarSemaforo, FAIXAS_COMPRA_DIRETA, type CorSemaforo } from "@/lib/rules/semaforos";

/**
 * Painel de performance da aba "Retirada Compra Direta" (Retiradas). Tipos e
 * agregação PURA — sem nenhum import de banco (usado por componentes client e
 * testes); a consulta real mora em `compraDiretaPainel.server.ts`.
 *
 * Regra de negócio inalterada: thresholds `FAIXAS_COMPRA_DIRETA` (até 5% =
 * Controlado; 5–7% = Atenção; acima de 7% = Crítico) e janela D-1 da aba
 * (aplicada pelo serviço de servidor, como em `buscarIndicadorPeriodo`).
 * Percentual da loja = Compra Direta ÷ faturamento da loja; percentual de
 * MOTIVO = valor do motivo ÷ total de Compra Direta (da loja ou da rede) —
 * nunca sobre o faturamento.
 */

export type StatusCompraDireta = "controlado" | "atencao" | "critico";

export const ROTULO_STATUS: Record<StatusCompraDireta, string> = {
  controlado: "Controlado",
  atencao: "Atenção",
  critico: "Crítico",
};

/** Limite saudável (fim da faixa "Controlado") — referência dos thresholds existentes, não meta nova. */
export const LIMITE_SAUDAVEL_COMPRA_DIRETA = FAIXAS_COMPRA_DIRETA.find((f) => f.cor === "verde")?.ateInclusive ?? 5;

export function statusDoPercentual(percentual: number): { status: StatusCompraDireta; cor: CorSemaforo } {
  const cor = classificarSemaforo(percentual, FAIXAS_COMPRA_DIRETA);
  return { status: cor === "vermelho" ? "critico" : cor === "amarelo" ? "atencao" : "controlado", cor };
}

export interface DiaCompraDireta {
  /** AAAA-MM-DD (data de ocorrência). */
  data: string;
  valor: number;
  faturamento: number;
  /** Composição do dia por motivo (maior valor primeiro) — alimenta o detalhamento ao clicar no gráfico. */
  motivos: { motivo: string; valor: number }[];
}

export interface MotivoCompraDireta {
  motivo: string;
  valor: number;
  /** valor do motivo ÷ total de Compra Direta do escopo (loja ou rede) × 100 — NÃO é sobre o faturamento. */
  percentualDoTotal: number;
  /** Soma acumulada do percentual (Pareto), em ordem decrescente de valor. */
  percentualAcumulado: number;
}

export interface LojaCompraDireta {
  unidade: string;
  faturamento: number;
  valor: number;
  percentual: number;
  status: StatusCompraDireta;
  cor: CorSemaforo;
  motivos: MotivoCompraDireta[];
  diario: DiaCompraDireta[];
}

export interface PeriodoCompraDireta {
  /** Janela de ocorrência efetivamente consultada (já com D-1 aplicado). */
  inicioOcorrencia: string;
  fimOcorrencia: string;
  /** false = nenhum registro de Compra Direta na janela ("Sem dados"). */
  disponivel: boolean;
  faturamento: number;
  valor: number;
  percentual: number;
  status: StatusCompraDireta;
  cor: CorSemaforo;
  lojasForaDoLimite: number;
  contagemStatus: Record<StatusCompraDireta, number>;
  porLoja: LojaCompraDireta[];
  motivos: MotivoCompraDireta[];
  diario: DiaCompraDireta[];
}

export interface CompraDiretaPainelData {
  conectado: boolean;
  atual: PeriodoCompraDireta;
  comparacao: PeriodoCompraDireta;
}

export interface LinhaFaturamentoDia {
  codigo: string;
  data: string;
  valor: number;
}

export interface LinhaCompraDiretaDia {
  codigo: string;
  data: string;
  motivo: string;
  valor: number;
}

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Lista todos os dias AAAA-MM-DD de [inicio, fim] (UTC, inclusivo). */
export function diasDoIntervalo(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  const cursor = new Date(`${inicio}T00:00:00.000Z`);
  const limite = new Date(`${fim}T00:00:00.000Z`).getTime();
  while (cursor.getTime() <= limite && dias.length < 800) {
    dias.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

/** Motivos em ordem decrescente de valor, com % do total do escopo e % acumulado (Pareto). Preserva os motivos exatamente como estão na base. */
export function agruparMotivos(linhas: { motivo: string; valor: number }[]): MotivoCompraDireta[] {
  const mapa = new Map<string, number>();
  for (const l of linhas) mapa.set(l.motivo, (mapa.get(l.motivo) ?? 0) + l.valor);
  const total = [...mapa.values()].reduce((s, v) => s + v, 0);
  let acumulado = 0;
  return [...mapa.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([motivo, valor]) => {
      const pct = total > 0 ? (valor / total) * 100 : 0;
      acumulado += pct;
      return { motivo, valor: arred(valor), percentualDoTotal: pct, percentualAcumulado: Math.min(acumulado, 100) };
    });
}

/** Agrega as linhas brutas (loja × dia [× motivo]) de UM período em toda a estrutura do painel. */
export function montarPeriodoCompraDireta(
  inicioOcorrencia: string,
  fimOcorrencia: string,
  faturamentoLinhas: LinhaFaturamentoDia[],
  compraDiretaLinhas: LinhaCompraDiretaDia[]
): PeriodoCompraDireta {
  const dias = diasDoIntervalo(inicioOcorrencia, fimOcorrencia);

  const fatLojaDia = new Map<string, Map<string, number>>();
  for (const l of faturamentoLinhas) {
    const m = fatLojaDia.get(l.codigo) ?? new Map<string, number>();
    m.set(l.data, (m.get(l.data) ?? 0) + l.valor);
    fatLojaDia.set(l.codigo, m);
  }
  const cdLojaDia = new Map<string, Map<string, number>>();
  const cdLojaMotivos = new Map<string, { motivo: string; valor: number }[]>();
  const cdLojaDiaMotivo = new Map<string, Map<string, Map<string, number>>>();
  for (const l of compraDiretaLinhas) {
    const m = cdLojaDia.get(l.codigo) ?? new Map<string, number>();
    m.set(l.data, (m.get(l.data) ?? 0) + l.valor);
    cdLojaDia.set(l.codigo, m);
    const mot = cdLojaMotivos.get(l.codigo) ?? [];
    mot.push({ motivo: l.motivo, valor: l.valor });
    cdLojaMotivos.set(l.codigo, mot);
    const porDia = cdLojaDiaMotivo.get(l.codigo) ?? new Map<string, Map<string, number>>();
    const porMotivo = porDia.get(l.data) ?? new Map<string, number>();
    porMotivo.set(l.motivo, (porMotivo.get(l.motivo) ?? 0) + l.valor);
    porDia.set(l.data, porMotivo);
    cdLojaDiaMotivo.set(l.codigo, porDia);
  }

  const motivosDoDia = (mapa?: Map<string, number>) =>
    [...(mapa?.entries() ?? [])]
      .map(([motivo, valor]) => ({ motivo, valor: arred(valor) }))
      .sort((a, b) => b.valor - a.valor || a.motivo.localeCompare(b.motivo));

  const codigos = new Set<string>([...fatLojaDia.keys(), ...cdLojaDia.keys()]);
  const porLoja: LojaCompraDireta[] = UNIDADES.filter((u) => codigos.has(u)).map((unidade) => {
    const diario = dias.map((data) => ({
      data,
      valor: arred(cdLojaDia.get(unidade)?.get(data) ?? 0),
      faturamento: arred(fatLojaDia.get(unidade)?.get(data) ?? 0),
      motivos: motivosDoDia(cdLojaDiaMotivo.get(unidade)?.get(data)),
    }));
    const faturamento = diario.reduce((s, d) => s + d.faturamento, 0);
    const valor = diario.reduce((s, d) => s + d.valor, 0);
    const percentual = faturamento > 0 ? (valor / faturamento) * 100 : 0;
    const { status, cor } = statusDoPercentual(percentual);
    return {
      unidade,
      faturamento: arred(faturamento),
      valor: arred(valor),
      percentual,
      status,
      cor,
      motivos: agruparMotivos(cdLojaMotivos.get(unidade) ?? []),
      diario,
    };
  });

  const diario: DiaCompraDireta[] = dias.map((data) => ({
    data,
    valor: arred(porLoja.reduce((s, l) => s + (l.diario.find((d) => d.data === data)?.valor ?? 0), 0)),
    faturamento: arred(porLoja.reduce((s, l) => s + (l.diario.find((d) => d.data === data)?.faturamento ?? 0), 0)),
    motivos: (() => {
      const soma = new Map<string, number>();
      for (const l of porLoja) for (const m of l.diario.find((d) => d.data === data)?.motivos ?? []) soma.set(m.motivo, (soma.get(m.motivo) ?? 0) + m.valor);
      return motivosDoDia(soma);
    })(),
  }));

  const faturamento = arred(porLoja.reduce((s, l) => s + l.faturamento, 0));
  const valor = arred(porLoja.reduce((s, l) => s + l.valor, 0));
  const percentual = faturamento > 0 ? (valor / faturamento) * 100 : 0;
  const { status, cor } = statusDoPercentual(percentual);
  const contagemStatus: Record<StatusCompraDireta, number> = { controlado: 0, atencao: 0, critico: 0 };
  for (const l of porLoja) contagemStatus[l.status]++;

  return {
    inicioOcorrencia,
    fimOcorrencia,
    disponivel: compraDiretaLinhas.length > 0,
    faturamento,
    valor,
    percentual,
    status,
    cor,
    lojasForaDoLimite: contagemStatus.atencao + contagemStatus.critico,
    contagemStatus,
    porLoja,
    motivos: agruparMotivos(compraDiretaLinhas.map((l) => ({ motivo: l.motivo, valor: l.valor }))),
    diario,
  };
}

export type SituacaoMotivo = "melhorou" | "piorou" | "sem-alteracao";

/** Compra Direta: valor menor = melhorou; maior = piorou (só para Compra Direta e seus motivos — nunca Faturamento). */
export function situacaoCompraDireta(atual: number, comparado: number): SituacaoMotivo {
  const delta = atual - comparado;
  if (Math.abs(delta) < 0.005) return "sem-alteracao";
  return delta < 0 ? "melhorou" : "piorou";
}

export interface LinhaComparativoMotivo<T extends { motivo: string; valor: number } = MotivoCompraDireta> {
  motivo: string;
  atual?: T;
  comparado?: T;
}

/** União dos motivos dos dois períodos: primeiro os do período atual (maior valor), depois os que só existiam no comparado. Motivos preservados como na base. */
export function compararMotivos<T extends { motivo: string; valor: number }>(atual: T[], comparado: T[]): LinhaComparativoMotivo<T>[] {
  const mapa = new Map<string, LinhaComparativoMotivo<T>>();
  for (const m of atual) mapa.set(m.motivo, { motivo: m.motivo, atual: m });
  for (const m of comparado) mapa.set(m.motivo, { ...(mapa.get(m.motivo) ?? { motivo: m.motivo }), comparado: m });
  return [...mapa.values()].sort(
    (a, b) => (b.atual?.valor ?? 0) - (a.atual?.valor ?? 0) || (b.comparado?.valor ?? 0) - (a.comparado?.valor ?? 0) || a.motivo.localeCompare(b.motivo)
  );
}

/** Variação de um motivo: diferença em R$, % calculado sobre o valor do período COMPARADO (null se o comparado é 0) e a situação. */
export function variacaoCompraDireta(atual: number, comparado: number): { delta: number; percentual: number | null; situacao: SituacaoMotivo } {
  const delta = atual - comparado;
  return { delta, percentual: comparado !== 0 ? (delta / comparado) * 100 : null, situacao: situacaoCompraDireta(atual, comparado) };
}
