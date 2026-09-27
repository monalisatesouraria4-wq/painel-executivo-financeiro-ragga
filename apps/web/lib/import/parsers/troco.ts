import { normalizarUnidade } from "../normalizarUnidade";
import { parseDataCelula, parseValorCelula, parseTextoCelula } from "../parseCelula";
import { localizarColuna } from "../localizarColuna";
import type { ResultadoParse, RegistroBase } from "../tipos";

/**
 * Parser de Troco. Fonte confirmada: `TROCO SEMANAL.xlsx`.
 *
 * Estrutura real: LOJA, DATA, CAIXA, R$ TROCO CONFERIDO PELO GERENTE,
 * R$ TROCO INFORMADO PELO COLABORADOR, DIFERENÇA TROCO (fórmula),
 * OPERADOR, PLANO DE AÇÃO.
 *
 * A coluna de diferença é uma fórmula de tabela do Excel
 * (`Tabela1[[#This Row],[...]]-Tabela1[[#This Row],[...]]`) e, na
 * maioria das linhas reais (confirmado: 1547 de 1630), o ExcelJS não
 * traz um resultado cacheado para ela. Em vez de depender desse cache
 * ausente, a diferença é recalculada aqui como
 * `trocoConferidoGerente - trocoInformadoColaborador` — exatamente a
 * mesma subtração que a fórmula da própria planilha descreve, não uma
 * regra nova.
 *
 * Preserva os dois valores separadamente (não escolhe um), conforme já
 * confirmado. `RegistroBase.valor` recebe o troco conferido pelo
 * gerente (por ser a validação formal), com o informado pelo
 * colaborador preservado em `extras`.
 *
 * Colunas "OPERADOR" e "PLANO DE AÇÃO" existem na fonte real mas não têm
 * campo correspondente no schema aprovado (`troco`) — não persistidas,
 * sinalizado em docs/regras-negocio.md.
 */
export function parseTroco(cabecalho: unknown[], linhas: unknown[][]): ResultadoParse {
  const idxLoja = localizarColuna(cabecalho, "LOJA");
  const idxData = localizarColuna(cabecalho, "DATA");
  const idxCaixa = localizarColuna(cabecalho, "CAIXA");
  const idxConferido = localizarColuna(cabecalho, "TROCO CONFERIDO");
  const idxInformado = localizarColuna(cabecalho, "TROCO  INFORMADO"); // header real tem 2 espaços aqui
  const idxInformadoAlt = localizarColuna(cabecalho, "TROCO INFORMADO"); // fallback com 1 espaço

  const resultado: ResultadoParse = { registros: [], rejeitados: [] };

  linhas.forEach((linha, i) => {
    const linhaOrigem = i + 2;
    const vazio = linha.every((v) => v === null || v === undefined || v === "");
    if (vazio) return;

    const valoresBrutos: Record<string, unknown> = {
      LOJA: linha[idxLoja],
      DATA: linha[idxData],
      CAIXA: linha[idxCaixa],
    };

    const unidadeResultado = normalizarUnidade(parseTextoCelula(linha[idxLoja]));
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
    if (!caixa) {
      resultado.rejeitados.push({ linhaOrigem, motivo: "Caixa vazio", valoresBrutos });
      return;
    }

    const conferido = parseValorCelula(linha[idxConferido]);
    if (conferido === null) {
      resultado.rejeitados.push({
        linhaOrigem,
        motivo: `Troco conferido pelo gerente inválido: "${String(linha[idxConferido])}"`,
        valoresBrutos,
      });
      return;
    }

    const idxInf = idxInformado >= 0 ? idxInformado : idxInformadoAlt;
    const informado = parseValorCelula(linha[idxInf]);
    if (informado === null) {
      resultado.rejeitados.push({
        linhaOrigem,
        motivo: `Troco informado pelo colaborador inválido: "${String(linha[idxInf])}"`,
        valoresBrutos,
      });
      return;
    }

    const diferenca = Math.round((conferido - informado) * 100) / 100;

    const registro: RegistroBase = {
      unidade: unidadeResultado.codigo,
      data,
      valor: conferido,
      extras: {
        caixa,
        trocoConferidoGerente: String(conferido),
        trocoInformadoColaborador: String(informado),
        diferenca: String(diferenca),
      },
      linhaOrigem,
    };
    resultado.registros.push(registro);
  });

  return resultado;
}
