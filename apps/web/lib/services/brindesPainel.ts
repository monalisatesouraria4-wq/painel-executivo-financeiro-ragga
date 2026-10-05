import { UNIDADES } from "@painel/shared";
import { classificarBrinde } from "@/lib/rules/brindes";
import { classificarSemaforo, FAIXAS_BRINDES, type CorSemaforo } from "@/lib/rules/semaforos";
import { diasDoIntervalo } from "@/lib/services/compraDiretaPainel";

/**
 * Painel de performance da aba Brindes (Indicadores). Tipos e agregação PURA — sem import de banco (usado por
 * componentes client e testes); a consulta mora em `brindesPainel.server.ts`.
 *
 * Regras reutilizadas, nenhuma nova:
 * - Classificação controlável × não controlável: `classificarBrinde(motivo, motivo2)` (`lib/rules/brindes.ts`);
 *   os "motivos" exibidos são os rótulos dessa mesma classificação (Presente, Taxa Extra, Aniversariante,
 *   Consumo Funcionários, Empresas Parceiras...).
 * - TOTAL de Brindes = controláveis + não controláveis (indicador operacional).
 * - SEMÁFORO / status: SOMENTE controláveis ÷ faturamento, com `FAIXAS_BRINDES` (até 0,25% Excelente; até
 *   0,40% Atenção; acima Crítico). Total e não controláveis nunca definem o status.
 * - Janela D-1 da aba (aplicada pelo serviço de servidor, como em `buscarIndicadorPeriodo`).
 */

export const LIMITE_SAUDAVEL_BRINDES = FAIXAS_BRINDES.find((f) => f.cor === "azul")?.ateInclusive ?? 0.25;
export const LIMITE_ATENCAO_BRINDES = FAIXAS_BRINDES.find((f) => f.cor === "amarelo")?.ateInclusive ?? 0.4;

export type StatusBrinde = "excelente" | "atencao" | "critico";

export const ROTULO_STATUS_BRINDE: Record<StatusBrinde, string> = {
  excelente: "Excelente",
  atencao: "Atenção",
  critico: "Crítico",
};

/** Status pelo percentual dos CONTROLÁVEIS sobre o faturamento (thresholds existentes). */
export function statusBrindes(percentualControlaveis: number): { status: StatusBrinde; cor: CorSemaforo } {
  const cor = classificarSemaforo(percentualControlaveis, FAIXAS_BRINDES);
  return { status: cor === "vermelho" ? "critico" : cor === "amarelo" ? "atencao" : "excelente", cor };
}

export interface MotivoBrinde {
  /** Rótulo da classificação existente (ex.: "Presente", "Taxa Extra", "Empresas Parceiras"). */
  motivo: string;
  controlavel: boolean;
  valor: number;
  /** valor do motivo ÷ total de brindes do escopo (loja/rede) × 100. */
  percentualDoTotal: number;
}

export interface DiaBrindes {
  /** AAAA-MM-DD (data de ocorrência). */
  data: string;
  /** Total de brindes do dia (controláveis + não controláveis) — é o que a linha do gráfico representa. */
  valor: number;
  faturamento: number;
  controlaveis: number;
  naoControlaveis: number;
  motivos: { motivo: string; controlavel: boolean; valor: number }[];
}

interface Totais {
  faturamento: number;
  total: number;
  controlaveis: number;
  naoControlaveis: number;
  /** total ÷ faturamento (operacional — não define o semáforo). */
  percentualTotal: number;
  /** controláveis ÷ faturamento — base do semáforo. */
  percentualControlaveis: number;
  percentualNaoControlaveis: number;
  status: StatusBrinde;
  cor: CorSemaforo;
}

export interface LojaBrindes extends Totais {
  unidade: string;
  motivos: MotivoBrinde[];
  diario: DiaBrindes[];
}

export interface PeriodoBrindes extends Totais {
  inicioOcorrencia: string;
  fimOcorrencia: string;
  /** false = nenhum registro de Brindes na janela ("Sem dados"). */
  disponivel: boolean;
  contagemStatus: Record<StatusBrinde, number>;
  lojasForaDoLimite: number;
  porLoja: LojaBrindes[];
  motivos: MotivoBrinde[];
  diario: DiaBrindes[];
}

export interface BrindesPainelData {
  conectado: boolean;
  atual: PeriodoBrindes;
  comparacao: PeriodoBrindes;
}

export interface LinhaFaturamentoDia {
  codigo: string;
  data: string;
  valor: number;
}

export interface LinhaBrindeDia {
  codigo: string;
  data: string;
  motivo: string;
  motivo2: string;
  valor: number;
}

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

function totais(faturamento: number, controlaveis: number, naoControlaveis: number): Totais {
  const total = controlaveis + naoControlaveis;
  const pctCtrl = faturamento > 0 ? (controlaveis / faturamento) * 100 : 0;
  const { status, cor } = statusBrindes(pctCtrl);
  return {
    faturamento: arred(faturamento),
    total: arred(total),
    controlaveis: arred(controlaveis),
    naoControlaveis: arred(naoControlaveis),
    percentualTotal: faturamento > 0 ? (total / faturamento) * 100 : 0,
    percentualControlaveis: pctCtrl,
    percentualNaoControlaveis: faturamento > 0 ? (naoControlaveis / faturamento) * 100 : 0,
    status,
    cor,
  };
}

/** Agrupa por rótulo de motivo (controláveis e não controláveis), maior valor primeiro, com % sobre o total do escopo. */
export function agruparMotivosBrinde(linhas: { motivo: string; controlavel: boolean; valor: number }[]): MotivoBrinde[] {
  const mapa = new Map<string, { controlavel: boolean; valor: number }>();
  for (const l of linhas) {
    const atual = mapa.get(l.motivo);
    mapa.set(l.motivo, { controlavel: l.controlavel, valor: (atual?.valor ?? 0) + l.valor });
  }
  const total = [...mapa.values()].reduce((s, m) => s + m.valor, 0);
  return [...mapa.entries()]
    .filter(([, m]) => m.valor !== 0)
    .sort((a, b) => b[1].valor - a[1].valor || a[0].localeCompare(b[0]))
    .map(([motivo, m]) => ({ motivo, controlavel: m.controlavel, valor: arred(m.valor), percentualDoTotal: total > 0 ? (m.valor / total) * 100 : 0 }));
}

/** Agrega as linhas brutas (loja × dia [× motivo × submotivo]) de UM período em toda a estrutura do painel. */
export function montarPeriodoBrindes(
  inicioOcorrencia: string,
  fimOcorrencia: string,
  faturamentoLinhas: LinhaFaturamentoDia[],
  brindesLinhas: LinhaBrindeDia[]
): PeriodoBrindes {
  const dias = diasDoIntervalo(inicioOcorrencia, fimOcorrencia);

  const fatLojaDia = new Map<string, Map<string, number>>();
  for (const l of faturamentoLinhas) {
    const m = fatLojaDia.get(l.codigo) ?? new Map<string, number>();
    m.set(l.data, (m.get(l.data) ?? 0) + l.valor);
    fatLojaDia.set(l.codigo, m);
  }

  // loja → dia → motivo(rótulo) → {controlavel, valor}
  const brLojaDia = new Map<string, Map<string, Map<string, { controlavel: boolean; valor: number }>>>();
  for (const l of brindesLinhas) {
    const c = classificarBrinde(l.motivo, l.motivo2);
    const porDia = brLojaDia.get(l.codigo) ?? new Map<string, Map<string, { controlavel: boolean; valor: number }>>();
    const porMotivo = porDia.get(l.data) ?? new Map<string, { controlavel: boolean; valor: number }>();
    const atual = porMotivo.get(c.rotulo);
    porMotivo.set(c.rotulo, { controlavel: c.controlavel, valor: (atual?.valor ?? 0) + l.valor });
    porDia.set(l.data, porMotivo);
    brLojaDia.set(l.codigo, porDia);
  }

  const codigos = new Set<string>([...fatLojaDia.keys(), ...brLojaDia.keys()]);
  const porLoja: LojaBrindes[] = UNIDADES.filter((u) => codigos.has(u)).map((unidade) => {
    const diario: DiaBrindes[] = dias.map((data) => {
      const motivos = [...(brLojaDia.get(unidade)?.get(data)?.entries() ?? [])]
        .map(([motivo, m]) => ({ motivo, controlavel: m.controlavel, valor: arred(m.valor) }))
        .sort((a, b) => b.valor - a.valor || a.motivo.localeCompare(b.motivo));
      const controlaveis = motivos.filter((m) => m.controlavel).reduce((s, m) => s + m.valor, 0);
      const naoControlaveis = motivos.filter((m) => !m.controlavel).reduce((s, m) => s + m.valor, 0);
      return {
        data,
        valor: arred(controlaveis + naoControlaveis),
        faturamento: arred(fatLojaDia.get(unidade)?.get(data) ?? 0),
        controlaveis: arred(controlaveis),
        naoControlaveis: arred(naoControlaveis),
        motivos,
      };
    });
    const fat = diario.reduce((s, d) => s + d.faturamento, 0);
    const ctrl = diario.reduce((s, d) => s + d.controlaveis, 0);
    const nao = diario.reduce((s, d) => s + d.naoControlaveis, 0);
    return {
      unidade,
      ...totais(fat, ctrl, nao),
      motivos: agruparMotivosBrinde(diario.flatMap((d) => d.motivos)),
      diario,
    };
  });

  const diario: DiaBrindes[] = dias.map((data) => {
    const soma = new Map<string, { controlavel: boolean; valor: number }>();
    let faturamento = 0;
    for (const l of porLoja) {
      const d = l.diario.find((x) => x.data === data);
      if (!d) continue;
      faturamento += d.faturamento;
      for (const m of d.motivos) soma.set(m.motivo, { controlavel: m.controlavel, valor: (soma.get(m.motivo)?.valor ?? 0) + m.valor });
    }
    const motivos = [...soma.entries()]
      .map(([motivo, m]) => ({ motivo, controlavel: m.controlavel, valor: arred(m.valor) }))
      .sort((a, b) => b.valor - a.valor || a.motivo.localeCompare(b.motivo));
    const controlaveis = motivos.filter((m) => m.controlavel).reduce((s, m) => s + m.valor, 0);
    const naoControlaveis = motivos.filter((m) => !m.controlavel).reduce((s, m) => s + m.valor, 0);
    return { data, valor: arred(controlaveis + naoControlaveis), faturamento: arred(faturamento), controlaveis: arred(controlaveis), naoControlaveis: arred(naoControlaveis), motivos };
  });

  const geral = totais(
    porLoja.reduce((s, l) => s + l.faturamento, 0),
    porLoja.reduce((s, l) => s + l.controlaveis, 0),
    porLoja.reduce((s, l) => s + l.naoControlaveis, 0)
  );
  const contagemStatus: Record<StatusBrinde, number> = { excelente: 0, atencao: 0, critico: 0 };
  for (const l of porLoja) contagemStatus[l.status]++;

  return {
    inicioOcorrencia,
    fimOcorrencia,
    disponivel: brindesLinhas.length > 0,
    ...geral,
    contagemStatus,
    lojasForaDoLimite: contagemStatus.atencao + contagemStatus.critico,
    porLoja,
    motivos: agruparMotivosBrinde(diario.flatMap((d) => d.motivos)),
    diario,
  };
}
