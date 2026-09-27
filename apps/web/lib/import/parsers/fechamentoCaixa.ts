import { normalizarUnidade } from "../normalizarUnidade";
import { parseDataCelula, parseValorCelula, parseTextoCelula } from "../parseCelula";
import { localizarColunaExata } from "../localizarColuna";
import type { ResultadoParse, RegistroBase } from "../tipos";

/**
 * Parser de Fechamento de Caixa. Fonte confirmada (Etapa 3/4):
 * `FECHAMENTO DE CAIXA - ABERTOS_FECHADOS_CONCILIADOS.xlsx.xlsx`.
 *
 * Estrutura real (sem coluna de valor monetário — confirmado e mantido):
 * Data, Filial, Caixa, Movto., Abertura, Fechamento, Operador, Situação,
 * Dif. fech., Dif. conc., Dif. total.
 *
 * `RegistroBase.valor` exige um number — como não há valor monetário
 * nesta base, usa-se `0` como placeholder (nunca lido/somado no
 * relatório desta base); os dados reais ficam em `extras`. As três
 * colunas de diferença são preservadas como texto em `extras` (podem
 * ser nulas na fonte) para não perder precisão/nulidade ao passar pelo
 * relatório genérico.
 *
 * Sem deduplicação (mantido) — chave de auditoria filial+data+caixa+
 * movimento, já confirmada e usada apenas para o relatório de colisões,
 * nunca para descartar linhas.
 */
export function parseFechamentoCaixa(cabecalho: unknown[], linhas: unknown[][]): ResultadoParse {
  const idxData = localizarColunaExata(cabecalho, "DATA");
  const idxFilial = localizarColunaExata(cabecalho, "FILIAL");
  const idxCaixa = localizarColunaExata(cabecalho, "CAIXA");
  const idxMovimento = localizarColunaExata(cabecalho, "MOVTO.");
  const idxAbertura = localizarColunaExata(cabecalho, "ABERTURA");
  const idxFechamento = localizarColunaExata(cabecalho, "FECHAMENTO");
  const idxOperador = localizarColunaExata(cabecalho, "OPERADOR");
  const idxSituacao = localizarColunaExata(cabecalho, "SITUACAO");
  const idxDifFechamento = localizarColunaExata(cabecalho, "DIF. FECH.");
  const idxDifConciliacao = localizarColunaExata(cabecalho, "DIF. CONC.");
  const idxDifTotal = localizarColunaExata(cabecalho, "DIF. TOTAL");

  const resultado: ResultadoParse = { registros: [], rejeitados: [] };

  linhas.forEach((linha, i) => {
    const linhaOrigem = i + 2;
    const vazio = linha.every((v) => v === null || v === undefined || v === "");
    if (vazio) return;

    const valoresBrutos: Record<string, unknown> = {
      DATA: linha[idxData],
      FILIAL: linha[idxFilial],
      CAIXA: linha[idxCaixa],
      "MOVTO.": linha[idxMovimento],
    };

    const unidadeResultado = normalizarUnidade(parseTextoCelula(linha[idxFilial]));
    if (!unidadeResultado.ok) {
      resultado.rejeitados.push({
        linhaOrigem,
        motivo: `Unidade não reconhecida: "${unidadeResultado.valorOriginal}"`,
        valoresBrutos,
      });
      return;
    }

    const data = parseDataCelula(linha[idxData]);
    if (!data) {
      resultado.rejeitados.push({ linhaOrigem, motivo: `Data inválida: "${String(linha[idxData])}"`, valoresBrutos });
      return;
    }

    const caixa = parseTextoCelula(linha[idxCaixa]);
    const movimento = parseTextoCelula(linha[idxMovimento]);
    if (!caixa || !movimento) {
      resultado.rejeitados.push({
        linhaOrigem,
        motivo: `Caixa ou Movto. vazio (caixa="${caixa}", movto="${movimento}")`,
        valoresBrutos,
      });
      return;
    }

    const registro: RegistroBase = {
      unidade: unidadeResultado.codigo,
      data,
      valor: 0, // sem valor monetário na fonte — ver docstring do arquivo
      extras: {
        caixa,
        movimento,
        abertura: idxAbertura >= 0 ? parseTextoCelula(linha[idxAbertura]) : "",
        fechamento: idxFechamento >= 0 ? parseTextoCelula(linha[idxFechamento]) : "",
        operador: idxOperador >= 0 ? parseTextoCelula(linha[idxOperador]) : "",
        situacao: idxSituacao >= 0 ? parseTextoCelula(linha[idxSituacao]) : "",
        difFechamento: idxDifFechamento >= 0 ? String(parseValorCelula(linha[idxDifFechamento]) ?? "") : "",
        difConciliacao: idxDifConciliacao >= 0 ? String(parseValorCelula(linha[idxDifConciliacao]) ?? "") : "",
        difTotal: idxDifTotal >= 0 ? String(parseValorCelula(linha[idxDifTotal]) ?? "") : "",
      },
      linhaOrigem,
    };
    resultado.registros.push(registro);
  });

  return resultado;
}
