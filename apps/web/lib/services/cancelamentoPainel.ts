import { classificarSemaforo, FAIXAS_CANCELAMENTO, type CorSemaforo } from "@/lib/rules/semaforos";
import {
  montarPeriodoCompraDireta,
  type DiaCompraDireta,
  type LinhaCompraDiretaDia,
  type LinhaFaturamentoDia,
  type LojaCompraDireta,
  type MotivoCompraDireta,
  type PeriodoCompraDireta,
} from "@/lib/services/compraDiretaPainel";

/**
 * Painel de performance da aba Cancelamento Salão (Indicadores). Tipos e agregação PURA — sem import de banco.
 *
 * Reutiliza a agregação já validada (loja × dia × motivo, composição diária, dias sem registro) de
 * `montarPeriodoCompraDireta` — a estrutura é idêntica; só o STATUS muda: thresholds existentes de cancelamento
 * (`FAIXAS_CANCELAMENTO`: até 0,50% Excelente; até 1,00% Bom; até 2,00% Atenção; acima Crítico). Os motivos são
 * exatamente os da base ("MOT 01 - DESISTENCIA"...). A base NÃO tem quantidade de ocorrências (uma linha por
 * loja/dia/motivo, só valor) — por isso não há quantidade nem ticket médio.
 */

export type FonteCancelamentoPainel = "cancelamentoSalao" | "cancelamentoDelivery";

export type StatusCancelamento = "excelente" | "bom" | "atencao" | "critico";

export const ROTULO_STATUS_CANCELAMENTO: Record<StatusCancelamento, string> = {
  excelente: "Excelente",
  bom: "Bom",
  atencao: "Atenção",
  critico: "Crítico",
};

export const LIMITE_EXCELENTE_CANCELAMENTO = FAIXAS_CANCELAMENTO.find((f) => f.cor === "azul")?.ateInclusive ?? 0.5;
export const LIMITE_BOM_CANCELAMENTO = FAIXAS_CANCELAMENTO.find((f) => f.cor === "verde")?.ateInclusive ?? 1;
export const LIMITE_ATENCAO_CANCELAMENTO = FAIXAS_CANCELAMENTO.find((f) => f.cor === "amarelo")?.ateInclusive ?? 2;

export function statusCancelamento(percentual: number): { status: StatusCancelamento; cor: CorSemaforo } {
  const cor = classificarSemaforo(percentual, FAIXAS_CANCELAMENTO);
  const status: StatusCancelamento = cor === "vermelho" ? "critico" : cor === "amarelo" ? "atencao" : cor === "verde" ? "bom" : "excelente";
  return { status, cor };
}

export type DiaCancelamento = DiaCompraDireta;
export type MotivoCancelamento = MotivoCompraDireta;

export interface LojaCancelamento extends Omit<LojaCompraDireta, "status" | "cor"> {
  status: StatusCancelamento;
  cor: CorSemaforo;
}

export interface PeriodoCancelamento extends Omit<PeriodoCompraDireta, "status" | "cor" | "contagemStatus" | "porLoja"> {
  status: StatusCancelamento;
  cor: CorSemaforo;
  contagemStatus: Record<StatusCancelamento, number>;
  porLoja: LojaCancelamento[];
}

export interface CancelamentoPainelData {
  conectado: boolean;
  atual: PeriodoCancelamento;
  comparacao: PeriodoCancelamento;
}

/** Agrega um período (mesma estrutura da Compra Direta) e aplica os thresholds de CANCELAMENTO ao status. */
export function montarPeriodoCancelamento(
  inicioOcorrencia: string,
  fimOcorrencia: string,
  faturamentoLinhas: LinhaFaturamentoDia[],
  cancelamentoLinhas: LinhaCompraDiretaDia[]
): PeriodoCancelamento {
  const base = montarPeriodoCompraDireta(inicioOcorrencia, fimOcorrencia, faturamentoLinhas, cancelamentoLinhas);
  const contagemStatus: Record<StatusCancelamento, number> = { excelente: 0, bom: 0, atencao: 0, critico: 0 };
  const porLoja: LojaCancelamento[] = base.porLoja.map((l) => {
    const { status, cor } = statusCancelamento(l.percentual);
    contagemStatus[status]++;
    return { ...l, status, cor };
  });
  const geral = statusCancelamento(base.percentual);
  return {
    ...base,
    status: geral.status,
    cor: geral.cor,
    contagemStatus,
    lojasForaDoLimite: contagemStatus.atencao + contagemStatus.critico,
    porLoja,
  };
}
