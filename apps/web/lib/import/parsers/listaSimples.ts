import type { TipoBase } from "@painel/shared";
import { normalizarUnidade } from "../normalizarUnidade";
import { parseDataCelula, parseValorCelula, parseTextoCelula } from "../parseCelula";
import { localizarColuna, localizarColunaExata } from "../localizarColuna";
import type { ResultadoParse } from "../tipos";

interface CampoExtra {
  nome: string;
  coluna: string;
  exata?: boolean;
}

interface ConfigListaSimples {
  tipoBase: TipoBase;
  colunaUnidade: string;
  colunaData: string;
  colunaValor: string | null; // null = base sem coluna de valor monetário direta
  camposExtras: CampoExtra[];
}

/**
 * Configuração das bases "em lista simples" (cabeçalho na linha 1, uma
 * linha = um lançamento) confirmadas nos arquivos reais da Etapa 3.
 * Conferência e Quebra de Caixa NÃO usam este parser (estrutura por
 * abas com cabeçalho na linha 4/6 — ver lib/import/parsers/quebraCaixa.ts).
 */
export const CONFIGS_LISTA_SIMPLES: Record<string, ConfigListaSimples> = {
  brindes: {
    tipoBase: "brindes",
    colunaUnidade: "LOJA",
    colunaData: "DATA",
    colunaValor: "VALOR",
    camposExtras: [
      { nome: "motivo", coluna: "MOTIVO", exata: true },
      { nome: "motivo2", coluna: "MOTIVO 02" },
    ],
  },
  cancelamento_salao: {
    tipoBase: "cancelamento_salao",
    colunaUnidade: "FILIAL",
    colunaData: "DATA/HORA ESTORNO",
    colunaValor: "VALOR TOTAL",
    camposExtras: [{ nome: "motivo", coluna: "MOTIVO", exata: true }],
  },
  cancelamento_delivery: {
    tipoBase: "cancelamento_delivery",
    colunaUnidade: "FILIAL",
    colunaData: "DATA/HORA",
    colunaValor: "TOTAL DO PEDIDO",
    camposExtras: [{ nome: "motivo", coluna: "MOTIVO", exata: true }],
  },
  compra_direta: {
    tipoBase: "compra_direta",
    colunaUnidade: "FILIAL",
    colunaData: "DATA",
    colunaValor: "VALOR",
    camposExtras: [{ nome: "motivo", coluna: "MOTIVO", exata: true }],
  },
};

export function parseListaSimples(
  cabecalho: unknown[],
  linhas: unknown[][],
  config: ConfigListaSimples
): ResultadoParse {
  const idxUnidade = localizarColuna(cabecalho, config.colunaUnidade);
  const idxData = localizarColuna(cabecalho, config.colunaData);
  const idxValor = config.colunaValor ? localizarColuna(cabecalho, config.colunaValor) : -1;
  const idxExtras = config.camposExtras.map((c) => ({
    nome: c.nome,
    idx: c.exata ? localizarColunaExata(cabecalho, c.coluna) : localizarColuna(cabecalho, c.coluna),
  }));

  const resultado: ResultadoParse = { registros: [], rejeitados: [] };

  linhas.forEach((linha, i) => {
    const linhaOrigem = i + 2; // linha 1 é o cabeçalho
    const vazio = linha.every((v) => v === null || v === undefined || v === "");
    if (vazio) return;

    const valoresBrutos: Record<string, unknown> = {
      [config.colunaUnidade]: linha[idxUnidade],
      [config.colunaData]: linha[idxData],
    };

    const unidadeResultado = normalizarUnidade(parseTextoCelula(linha[idxUnidade]));
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
      resultado.rejeitados.push({
        linhaOrigem,
        motivo: `Data inválida: "${String(linha[idxData])}"`,
        valoresBrutos,
      });
      return;
    }

    let valor = 0;
    if (config.colunaValor) {
      const valorParseado = parseValorCelula(linha[idxValor]);
      if (valorParseado === null) {
        resultado.rejeitados.push({
          linhaOrigem,
          motivo: `Valor inválido: "${String(linha[idxValor])}"`,
          valoresBrutos,
        });
        return;
      }
      valor = valorParseado;
    }

    const extras: Record<string, string> = {};
    for (const { nome, idx } of idxExtras) {
      extras[nome] = idx >= 0 ? parseTextoCelula(linha[idx]) : "";
    }

    resultado.registros.push({
      unidade: unidadeResultado.codigo,
      data,
      valor,
      extras,
      linhaOrigem,
    });
  });

  return resultado;
}
