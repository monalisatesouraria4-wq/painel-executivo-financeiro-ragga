/**
 * Tipos client-safe do histórico mensal por loja (item 4/5 da etapa de
 * revisão — expansão da linha na tabela "Detalhamento por loja" da
 * Visão Geral). Sem import de banco aqui (mesmo motivo já documentado
 * em indicadores.ts/comparativoMensal.ts). Consulta real em
 * `historicoMensalLoja.server.ts`.
 */

export interface CelulaMensal {
  disponivel: boolean;
  valor?: number;
  percentualFaturamento?: number;
}

export interface LinhaHistoricoMensal {
  mes: string; // "YYYY-MM"
  faturamento: CelulaMensal;
  brindes: CelulaMensal;
  cancelamentoSalao: CelulaMensal;
  cancelamentoDelivery: CelulaMensal;
  compraDireta: CelulaMensal;
}

export interface HistoricoMensalLojaData {
  conectado: boolean;
  linhas: LinhaHistoricoMensal[];
}

export const NOME_MES: Record<string, string> = {
  "01": "Janeiro",
  "02": "Fevereiro",
  "03": "Março",
  "04": "Abril",
  "05": "Maio",
  "06": "Junho",
  "07": "Julho",
  "08": "Agosto",
  "09": "Setembro",
  "10": "Outubro",
  "11": "Novembro",
  "12": "Dezembro",
};

export function rotuloMesCompleto(mes: string): string {
  const [ano, mm] = mes.split("-");
  return `${NOME_MES[mm] ?? mm}/${ano}`;
}
