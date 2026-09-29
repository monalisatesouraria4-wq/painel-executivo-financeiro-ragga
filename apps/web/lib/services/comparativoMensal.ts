/**
 * Tipos client-safe do Comparativo por Mês — NENHUM import de banco aqui
 * (ver nota de arquitetura já documentada em indicadores.ts/
 * retiradaDeposito.ts: qualquer import de valor de um arquivo que também
 * importe `getDb()`/postgres é incluído no bundle do navegador por um
 * Client Component, mesmo que só para tipos — por isso os tipos ficam
 * neste arquivo e a consulta real fica em comparativoMensal.server.ts).
 */

export interface CelulaIndicador {
  disponivel: boolean;
  valor?: number;
}

export interface IndicadorMensal {
  label: string;
  porMes: Record<string, CelulaIndicador>;
}

export interface IndicadorExcluido {
  nome: string;
  motivo: string;
}

export interface ComparativoMensalData {
  conectado: boolean;
  /** Meses (formato "YYYY-MM") com pelo menos um indicador com dado, em ordem crescente. */
  meses: string[];
  faturamento: IndicadorMensal;
  brindes: IndicadorMensal;
  percentualBrindes: IndicadorMensal;
  cancelamentoSalao: IndicadorMensal;
  cancelamentoDelivery: IndicadorMensal;
  compraDireta: IndicadorMensal;
  trocoDiferenca: IndicadorMensal;
  trocoDivergencias: IndicadorMensal;
  quebraCaixa: IndicadorMensal;
  /** Indicadores que NÃO entraram no comparativo por falta de histórico mensal seguro (ver relatório). */
  indicadoresExcluidos: IndicadorExcluido[];
}

export const NOME_MES: Record<string, string> = {
  "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr", "05": "Mai", "06": "Jun",
  "07": "Jul", "08": "Ago", "09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
};

export function rotuloMes(mes: string): string {
  const [ano, mm] = mes.split("-");
  return `${NOME_MES[mm] ?? mm}/${ano.slice(2)}`;
}
