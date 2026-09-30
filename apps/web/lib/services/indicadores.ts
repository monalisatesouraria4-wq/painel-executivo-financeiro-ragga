import type { CodigoUnidade } from "@painel/shared";
import {
  FAIXAS_BRINDES,
  FAIXAS_CANCELAMENTO,
  FAIXAS_COMPRA_DIRETA,
  type CorSemaforo,
  type FaixaSemaforo,
} from "@/lib/rules/semaforos";

/**
 * Tipos e configuração da tela Indicadores — SEM NENHUM import de banco
 * (`lib/db/*`), de propósito: este arquivo é importado por componentes
 * client (`IndicadoresTabs.tsx`, `IndicadorPainel.tsx`, que usam
 * `FONTES_INDICADOR` como valor, não só como tipo). O driver Postgres é
 * Node-only — misturar os dois nesse arquivo vazava `net`/`tls`/
 * `perf_hooks` para o bundle do navegador (erro real de build
 * encontrado e corrigido nesta etapa, mesmo padrão já visto em
 * `atualizacaoBases.ts`/`persistirBase.ts`). A consulta real ao banco
 * mora em `indicadores.server.ts` (importado só pela Server Component
 * da página, nunca por componentes client).
 *
 * Espelha exatamente `createIndicatorController`/`render()` do painel
 * legado (linhas 2898-3134) e a configuração `COMP_SOURCES` (linhas
 * 1956-1977). Nomenclatura mantida EXATAMENTE como no legado.
 */

export type FonteIndicador = "brindes" | "cancelamentoSalao" | "cancelamentoDelivery" | "compraDireta";
export type ModoPeriodo = "dia" | "semana" | "mes" | "personalizado";

export interface ConfigFonteIndicador {
  fonte: FonteIndicador;
  label: string;
  hasSubmotivo: boolean;
  faixas: FaixaSemaforo[];
  semaforoLegend: string;
}

/** Espelha COMP_SOURCES (legado, linhas 1956-1977) — só os campos usados pela UI. */
export const FONTES_INDICADOR: ConfigFonteIndicador[] = [
  {
    fonte: "brindes",
    label: "Brindes",
    hasSubmotivo: true,
    faixas: FAIXAS_BRINDES,
    semaforoLegend: "Excelente: até 0,25% · Atenção: 0,26% a 0,40% · Crítico: acima de 0,40%",
  },
  {
    fonte: "cancelamentoSalao",
    label: "Cancelamento Salão",
    hasSubmotivo: false,
    faixas: FAIXAS_CANCELAMENTO,
    semaforoLegend: "Excelente: até 0,50% · Bom: 0,51% a 1,00% · Atenção: 1,01% a 2,00% · Crítico: acima de 2,00%",
  },
  {
    fonte: "cancelamentoDelivery",
    label: "Cancelamento Delivery",
    hasSubmotivo: false,
    faixas: FAIXAS_CANCELAMENTO,
    semaforoLegend: "Excelente: até 0,50% · Bom: 0,51% a 1,00% · Atenção: 1,01% a 2,00% · Crítico: acima de 2,00%",
  },
  {
    fonte: "compraDireta",
    label: "Retirada Compra Direta",
    hasSubmotivo: false,
    faixas: FAIXAS_COMPRA_DIRETA,
    semaforoLegend: "Controlado: até 5,00% · Atenção: 5,01% a 7,00% · Crítico: acima de 7,00%",
  },
];

export function buscarConfigFonte(fonte: FonteIndicador): ConfigFonteIndicador {
  return FONTES_INDICADOR.find((f) => f.fonte === fonte)!;
}

export interface SubmotivoLinha {
  submotivo: string;
  valor: number;
  ocorrencias: number;
}

export interface MotivoLinha {
  motivo: string;
  valor: number;
  percentualFaturamento: number;
  submotivos: SubmotivoLinha[];
}

export interface FilialIndicadorLinha {
  unidade: CodigoUnidade;
  valor: number;
  faturamento: number;
  percentualFaturamento: number;
  semaforo: CorSemaforo;
  /** Motivo de maior valor para essa loja (mesma janela D-1) — usado só para abrir a orientação correspondente na coluna Plano de Ação. */
  motivoPrincipal: string | null;
}

export interface IndicadorData {
  conectado: boolean;
  fonte: FonteIndicador;
  config: ConfigFonteIndicador;
  disponivel: boolean;
  totalIndicador: number | null;
  percentualFaturamento: number | null;
  semaforo: CorSemaforo | null;
  faturamentoPeriodo: number | null;
  porMotivo: MotivoLinha[];
  porFilial: FilialIndicadorLinha[];
}
