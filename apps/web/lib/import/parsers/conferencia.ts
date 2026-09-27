import { normalizarUnidade } from "../normalizarUnidade";
import { parseValorCelula, parseTextoCelula } from "../parseCelula";
import type { ResultadoParse, RegistroBase } from "../tipos";

/**
 * Parser de Conferência. Fonte: `CONTROLE DE CONFERENCIA E QUEBRAS DE
 * CAIXA (6).xlsx`, dentro da aba já resolvida por
 * `resolverAbaConferenciaPorData` (nunca escolhida pelo nome).
 *
 * Estrutura real (planejamento v4 — ver docs/regras-negocio.md, seção
 * "Divergência: Conferência"): uma linha por filial, colunas fixas
 * `Resp. pela Conferência | Filial | Qtd. caixas | <data 1> | <data 2> | ...`.
 * Cada célula de dia é: um NÚMERO (qtd. conferida), o texto "X"/"x"
 * (em atraso) ou vazia (sem lançamento ainda).
 *
 * Regra (confirmada pelo usuário, sem conversão silenciosa):
 * - qtdCadastrados = coluna "Qtd. caixas" (constante na linha).
 * - qtdConferidos = número da célula do dia; NULL se "X"/"x" ou vazia.
 * - emAtraso = true SOMENTE quando a célula é "X"/"x"; false caso
 *   contrário (inclusive quando vazia).
 * - Célula vazia: NÃO gera registro (ainda não há lançamento para
 *   aquele dia — nem número nem "X"). Contada à parte no relatório
 *   (`celulasVazias`), nunca persistida como um valor.
 *
 * @param linhaCompleta A linha 6 inteira da aba (colunas: Resp., Filial,
 *   Qtd. caixas, depois uma data por coluna).
 * @param linhasDados As linhas de filial (a partir da linha 7),
 *   alinhadas coluna a coluna com `linhaCompleta`.
 * @param fontePeriodoId Id da aba já resolvida (auditoria/rastreio —
 *   nunca compartilhado com quebra_caixa).
 */
export interface ResultadoParseConferencia extends ResultadoParse {
  celulasVazias: number;
}

const COL_RESP = 0;
const COL_FILIAL = 1;
const COL_QTD_CAIXAS = 2;
const COL_PRIMEIRA_DATA = 3;

function normalizarMarcacao(valor: unknown): "numero" | "atraso" | "vazio" | "invalido" {
  if (valor === null || valor === undefined || valor === "") return "vazio";
  if (typeof valor === "string" && valor.trim().toUpperCase() === "X") return "atraso";
  const numero = parseValorCelula(valor);
  if (numero !== null) return "numero";
  return "invalido";
}

export function parseConferencia(
  linhaCompleta: unknown[],
  linhasDados: unknown[][],
  fontePeriodoId: string
): ResultadoParseConferencia {
  const datas = linhaCompleta
    .slice(COL_PRIMEIRA_DATA)
    .map((v) => (v instanceof Date ? v : null));

  const registros: RegistroBase[] = [];
  const rejeitados: ResultadoParse["rejeitados"] = [];
  let celulasVazias = 0;

  linhasDados.forEach((linha, i) => {
    const linhaOrigem = i + 7; // dados começam na linha 7 da aba
    const vazio = linha.every((v) => v === null || v === undefined || v === "");
    if (vazio) return;

    const filialTexto = parseTextoCelula(linha[COL_FILIAL]);
    const valoresBrutosLinha: Record<string, unknown> = {
      "Resp. pela Conferência": linha[COL_RESP],
      Filial: linha[COL_FILIAL],
      "Qtd. caixas": linha[COL_QTD_CAIXAS],
    };

    const unidadeResultado = normalizarUnidade(filialTexto);
    if (!unidadeResultado.ok) {
      rejeitados.push({
        linhaOrigem,
        motivo: `Unidade não reconhecida: "${unidadeResultado.valorOriginal}"`,
        valoresBrutos: valoresBrutosLinha,
      });
      return;
    }

    const qtdCadastrados = parseValorCelula(linha[COL_QTD_CAIXAS]);
    if (qtdCadastrados === null) {
      rejeitados.push({
        linhaOrigem,
        motivo: `"Qtd. caixas" inválida: "${String(linha[COL_QTD_CAIXAS])}"`,
        valoresBrutos: valoresBrutosLinha,
      });
      return;
    }

    for (let colData = 0; colData < datas.length; colData++) {
      const data = datas[colData];
      if (!data) continue; // coluna sem data real na linha 6 — não é um dia do período

      const celula = linha[COL_PRIMEIRA_DATA + colData];
      const estado = normalizarMarcacao(celula);

      if (estado === "vazio") {
        celulasVazias++;
        continue;
      }

      if (estado === "invalido") {
        rejeitados.push({
          linhaOrigem,
          motivo: `Célula do dia ${data.toISOString().slice(0, 10)} não é número nem "X": "${String(celula)}"`,
          valoresBrutos: { ...valoresBrutosLinha, celula },
        });
        continue;
      }

      const emAtraso = estado === "atraso";
      const qtdConferidos = estado === "numero" ? parseValorCelula(celula) : null;

      registros.push({
        unidade: unidadeResultado.codigo,
        data,
        valor: 0, // sem campo de valor monetário nesta base — dados reais em extras
        extras: {
          qtdCadastrados: String(qtdCadastrados),
          qtdConferidos: qtdConferidos === null ? "" : String(qtdConferidos),
          emAtraso: String(emAtraso),
          fontePeriodoId,
        },
        linhaOrigem,
      });
    }
  });

  return { registros, rejeitados, celulasVazias };
}
