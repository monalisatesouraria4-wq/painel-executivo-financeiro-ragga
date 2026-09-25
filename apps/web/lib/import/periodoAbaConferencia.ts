/**
 * Extrai o período real (com ano) de uma aba de Conferência a partir do
 * seu próprio conteúdo — NUNCA do nome da aba.
 *
 * Confirmado nos arquivos reais (Etapa 3): cada aba de Conferência válida
 * tem, na linha 6, uma coluna por dia do período, com o valor sendo uma
 * data completa (com ano) do Excel — ex.: 2026-09-16 ... 2026-10-15 na
 * aba "16.09 a 15.10". O nome da aba é só um rótulo e não traz o ano;
 * a linha de datas é a fonte de verdade.
 *
 * Uma aba só é aceita como válida quando a linha 6 contém uma sequência
 * de datas reais, estritamente consecutivas dia a dia, sem nenhuma outra
 * coisa misturada (texto, fórmula, número) na mesma faixa de colunas. Se
 * a estrutura não bater com isso — como a aba real "16-10 A 15-09", que
 * na verdade tem o layout de Quebra de Caixa (colunas MÊS/DATA/LOJA/...,
 * não uma linha de datas) — a aba é rejeitada como estrutura inválida,
 * sem tentar corrigir ou interpretar o nome (planejamento v3, item 8).
 */

const MINIMO_DIAS_PERIODO_VALIDO = 7;

export type ResultadoPeriodoAba =
  | { valida: true; periodoInicio: Date; periodoFim: Date }
  | { valida: false; motivo: string };

/**
 * @param celulasLinhaDeDatas Os valores das células da linha 6 da aba,
 *   a partir da primeira coluna de dado (coluna "D" nos arquivos reais),
 *   exatamente como o ExcelJS entrega (Date | fórmula | texto | null).
 */
export function extrairPeriodoDaAbaConferencia(
  celulasLinhaDeDatas: unknown[]
): ResultadoPeriodoAba {
  const celulasNaoVazias = celulasLinhaDeDatas.filter((v) => v !== null && v !== undefined && v !== "");

  if (celulasNaoVazias.length === 0) {
    return { valida: false, motivo: "Linha de datas do período (linha 6) está vazia." };
  }

  const todasSaoData = celulasNaoVazias.every((v) => v instanceof Date);
  if (!todasSaoData) {
    return {
      valida: false,
      motivo:
        "A linha 6 não contém apenas datas — estrutura não corresponde a uma aba de Conferência válida.",
    };
  }

  const datas = celulasNaoVazias as Date[];

  if (datas.length < MINIMO_DIAS_PERIODO_VALIDO) {
    return {
      valida: false,
      motivo: `Período com apenas ${datas.length} dia(s) — abaixo do mínimo esperado (${MINIMO_DIAS_PERIODO_VALIDO}).`,
    };
  }

  for (let i = 1; i < datas.length; i++) {
    const diferencaDias = (datas[i].getTime() - datas[i - 1].getTime()) / 86_400_000;
    if (diferencaDias !== 1) {
      return {
        valida: false,
        motivo: `Datas da linha 6 não são consecutivas dia a dia (falha entre a posição ${i} e ${i + 1}).`,
      };
    }
  }

  return { valida: true, periodoInicio: datas[0], periodoFim: datas[datas.length - 1] };
}
