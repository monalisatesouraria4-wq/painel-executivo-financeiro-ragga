import { dataDMenos1, dataDMenos2 } from "@/lib/rules/datas";
import type { FormaPagamentoBuckets } from "./fechamentoWhatsapp";

/**
 * Camada de serviço de "Fechamento Semanal". Espelha
 * `computeSemanalReport`/`renderSemanal` do legado (linhas 4275-4557) —
 * auditoria funcional confirmada por código-fonte.
 *
 * Deslocamento de data por bloco (confirmado no legado, linhas
 * 4276-4338), desloca AS DUAS PONTAS do período selecionado:
 * - D-1 (`janelaD1`, reaproveita `dataDMenos1` já validada/testada em
 *   `lib/rules/datas.ts` — não duplicada aqui): Faturamento, Formas de
 *   Pagamento, Brindes, Cancelamento Delivery/Salão, Compra Direta.
 * - D-2 (`janelaD2`, reaproveita `dataDMenos2`): PDV × Maquininha.
 * - Data literal (sem deslocamento): Fechamento dos caixas, Quebra de
 *   Caixa, Troco — filtram exatamente `iniBase..fimBase`.
 * - Conferência: itera dia a dia dentro de `iniBase..fimBase` (data
 *   literal), mas o ATRASO é calculado contra a data de referência
 *   GLOBAL do sistema, nunca contra as pontas do período (confirmado no
 *   legado, `isAtraso(filial, d, refDateGlobal)`).
 *
 * Tela ao vivo mostra só 5 KPIs (Faturamento/Brindes/Cancelamentos
 * somados/Compra Direta/Quebra) — PDV×Maquininha, Troco, Conferência e
 * Fechamento só aparecem na imagem gerada (`buildSemanalImageHtml`), não
 * têm equivalente na tela ao vivo. Não existe botão "Copiar texto" nesta
 * tela (confirmado, diferente do WhatsApp) — só "Gerar imagem".
 *
 * Sem DATABASE_URL: `disponivel: false`, `report: null` — nenhum valor
 * inventado. `normalizarPeriodo`/`janelaD1`/`janelaD2` são funções
 * puras, testáveis independente de conexão.
 */

// timeZone: "UTC" é obrigatório aqui — as datas de negócio são sempre
// parseadas como UTC meia-noite (ver nota em lib/rules/deposito.ts);
// sem isso, o formatador usa o fuso local e pode exibir o dia anterior.
const formatadorDataBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

export interface PeriodoNormalizado {
  iniBase: Date;
  fimBase: Date;
  periodoLabel: string;
}

/** Porta fiel da normalização do período do legado (linhas 4276-4278): troca as datas se ini > fim, formata "dd/mm/aaaa a dd/mm/aaaa". */
export function normalizarPeriodo(iniISO: string, fimISO: string): PeriodoNormalizado {
  let iniBase = new Date(`${iniISO}T00:00:00.000Z`);
  let fimBase = new Date(`${fimISO}T00:00:00.000Z`);
  if (iniBase.getTime() > fimBase.getTime()) {
    [iniBase, fimBase] = [fimBase, iniBase];
  }
  const periodoLabel = `${formatadorDataBR.format(iniBase)} a ${formatadorDataBR.format(fimBase)}`;
  return { iniBase, fimBase, periodoLabel };
}

export interface Janela {
  inicio: Date;
  fim: Date;
}

/** D-1 aplicado às duas pontas do período (reaproveita `dataDMenos1`, legado linha 4281). */
export function janelaD1(iniBase: Date, fimBase: Date): Janela {
  return { inicio: dataDMenos1(iniBase), fim: dataDMenos1(fimBase) };
}

/** D-2 aplicado às duas pontas do período (reaproveita `dataDMenos2`, legado linha 4319). */
export function janelaD2(iniBase: Date, fimBase: Date): Janela {
  return { inicio: dataDMenos2(iniBase), fim: dataDMenos2(fimBase) };
}

export interface SemanalReportData {
  periodoLabel: string;
  faturamentoTotal: number;
  formaBuckets: FormaPagamentoBuckets;
  brindeTotal: number;
  brindeMotivoMap: Record<string, number>;
  cancDeliveryTotal: number;
  cancDeliveryMotivoMap: Record<string, number>;
  cancSalaoTotal: number;
  cancSalaoMotivoMap: Record<string, number>;
  compraDiretaTotal: number;
  compraDiretaMotivoMap: Record<string, number>;
  fechAbertos: number;
  fechFechados: number;
  fechConciliados: number;
  quebraTotal: number;
  quebraQtd: number;
  pdvTotalPdv: number;
  pdvTotalMaq: number;
  pdvDiferenca: number;
  trocoTotalInformado: number;
  trocoTotalConferido: number;
  trocoDiferenca: number;
  trocoQtdConferido: number;
  trocoQtdDivergencia: number;
  trocoQtdSemConferencia: number;
  confCadastro: number;
  confQtdConferidos: number;
  confQtdAtraso: number;
  confQtdPendentes: number;
  pctConferido: number | null;
}

export interface FechamentoSemanalData {
  conectado: boolean;
  disponivel: boolean;
  periodoLabel: string | null;
  report: SemanalReportData | null;
}

/**
 * Consulta real em `fechamentoSemanal.server.ts` (arquivo separado —
 * mesma fronteira "use server"/client-safe já documentada em
 * indicadores.ts/retiradaDeposito.ts: este arquivo não pode importar
 * `getDb()`, senão o bundler inclui o driver Postgres no bundle do
 * navegador quando um Client Component importa só os tipos daqui).
 */
