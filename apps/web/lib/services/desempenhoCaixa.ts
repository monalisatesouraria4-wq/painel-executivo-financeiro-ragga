import type { CodigoUnidade } from "@painel/shared";
import type { CorSemaforo } from "@/lib/rules/semaforos";

/**
 * Tipos da visão de Performance de Caixa — SEM import de banco (usados por
 * componentes client; a consulta mora em `desempenhoCaixa.server.ts`).
 */

export type IndicadorDesempenhoId =
  | "consumoFuncionarios"
  | "brindes"
  | "cancelamentoSalao"
  | "cancelamentoDelivery"
  | "compraDireta";

export interface LinhaLojaDesempenho {
  unidade: CodigoUnidade;
  valor: number;
  /** true = a base do indicador não trouxe lançamento desta loja no período (zero assumido, não confirmado). */
  semLancamento: boolean;
  faturamento: number | null;
  /** % do faturamento; null quando a loja não tem faturamento (sem base para avaliação). */
  percentual: number | null;
  semaforo: CorSemaforo | null;
  /** Desvio em R$ contra a meta (meta % × faturamento da loja). */
  desvioReais: number | null;
  /** Desvio relativo à meta, em %. */
  desvioPercentual: number | null;
  valorAnterior: number | null;
}

export interface MotivoDesempenho {
  motivo: string;
  valor: number;
  /** Participação no total do indicador, em %. */
  participacao: number;
}

export interface ConsumoLimite {
  limiteDiario: number;
  dias: number;
  /** Limite do período (limite diário × dias). */
  limitePeriodo: number;
  percentualUtilizado: number;
  mediaPorFuncionarioDia: number;
  funcionariosReferencia: number;
  /** Projeção de fechamento do mês (null fora de mês em andamento). */
  projecaoFechamento: number | null;
  limiteMes: number | null;
}

export interface IndicadorDesempenho {
  id: IndicadorDesempenhoId;
  titulo: string;
  /** Critério de avaliação exibido na tela (como a meta foi definida). */
  criterio: string;
  /** false = a base do indicador não tem nenhum lançamento no período. */
  disponivel: boolean;
  /** true = há lançamentos, mas não há faturamento para avaliar o percentual. */
  semBaseAvaliacao: boolean;
  valor: number;
  faturamento: number | null;
  percentual: number | null;
  metaPercentual: number | null;
  metaValor: number | null;
  desvioReais: number | null;
  desvioPercentual: number | null;
  semaforo: CorSemaforo | null;
  /** Período equivalente do mês anterior; `valor` null = sem dado naquele período. */
  anterior: { valor: number | null };
  variacaoReais: number | null;
  variacaoPercentual: number | null;
  porLoja: LinhaLojaDesempenho[];
  porMotivo: MotivoDesempenho[];
  /** Só para consumo de funcionários. */
  consumo?: ConsumoLimite;
  /** Observação quando algo não pode ser calculado (ex.: quadro de funcionários por loja). */
  nota?: string;
}

export interface PrioridadeAcao {
  indicador: IndicadorDesempenhoId;
  tituloIndicador: string;
  unidade: CodigoUnidade;
  semaforo: CorSemaforo;
  valor: number;
  percentual: number;
  desvioReais: number;
  desvioPercentual: number;
}

export interface DesempenhoCaixaData {
  conectado: boolean;
  dataInicio: Date;
  dataFim: Date;
  anteriorInicio: Date;
  anteriorFim: Date;
  indicadores: IndicadorDesempenho[];
}
