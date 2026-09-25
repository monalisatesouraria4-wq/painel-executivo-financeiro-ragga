import { normalizarUnidade } from "../normalizarUnidade";
import { parseDataCelula, parseValorCelula, parseTextoCelula } from "../parseCelula";
import { localizarColuna, localizarColunaExata } from "../localizarColuna";
import type { ResultadoParse, RegistroBase } from "../tipos";

/**
 * Parser de Faturamento — regra oficial confirmada a partir do código-fonte
 * do painel HTML atual (`lerArquivoFaturamento`, ver docs/regras-negocio.md,
 * seção "Regras Confirmadas a partir do Painel Atual").
 *
 * Fonte: arquivo no formato de `FATURAMENTO - 1 SEMESTRE 2026.xlsx`.
 * Colunas exigidas (mesmas 4 do painel atual): Filial, Data, Desc. pagam.,
 * Vl. pagamento — a granularidade real do arquivo é por cupom/forma de
 * pagamento, MUITO mais fina que a base `faturamento` (chave filial+data).
 *
 * Regra: SUM(Vl. pagamento) agrupado por Filial + Data. Nenhuma linha é
 * excluída por cancelamento ou valor negativo — replica exatamente o
 * comportamento hoje em produção. Se cupons cancelados aparecem neste
 * arquivo ou não, e se deveriam ser excluídos, é uma pendência EXPLÍCITA
 * (ver docs/regras-negocio.md) — não implementada aqui, propositalmente.
 */
export function parseFaturamento(cabecalho: unknown[], linhas: unknown[][]): ResultadoParse {
  const idxFilial = localizarColunaExata(cabecalho, "FILIAL");
  const idxData = localizarColunaExata(cabecalho, "DATA");
  const idxValor = localizarColuna(cabecalho, "VL. PAGAMENTO");
  // "Desc. pagam." não entra na chave/valor da base `faturamento`
  // (chave é só filial+data) — lida apenas para não perder a coluna caso
  // uma base de formas de pagamento venha a usá-la no futuro (pendência
  // à parte, ver docs/regras-negocio.md).
  const idxFormaPag = localizarColuna(cabecalho, "DESC. PAGAM.");

  const rejeitados: ResultadoParse["rejeitados"] = [];
  const somaPorChave = new Map<string, { unidade: RegistroBase["unidade"]; data: Date; valor: number }>();

  linhas.forEach((linha, i) => {
    const linhaOrigem = i + 2;
    const vazio = linha.every((v) => v === null || v === undefined || v === "");
    if (vazio) return;

    const valoresBrutos: Record<string, unknown> = {
      FILIAL: linha[idxFilial],
      DATA: linha[idxData],
      "VL. PAGAMENTO": linha[idxValor],
      "DESC. PAGAM.": idxFormaPag >= 0 ? linha[idxFormaPag] : undefined,
    };

    const unidadeResultado = normalizarUnidade(parseTextoCelula(linha[idxFilial]));
    if (!unidadeResultado.ok) {
      rejeitados.push({
        linhaOrigem,
        motivo: `Unidade não reconhecida: "${unidadeResultado.valorOriginal}"`,
        valoresBrutos,
      });
      return;
    }

    const data = parseDataCelula(linha[idxData]);
    if (!data) {
      rejeitados.push({ linhaOrigem, motivo: `Data inválida: "${String(linha[idxData])}"`, valoresBrutos });
      return;
    }

    const valor = parseValorCelula(linha[idxValor]);
    if (valor === null) {
      rejeitados.push({ linhaOrigem, motivo: `Valor inválido: "${String(linha[idxValor])}"`, valoresBrutos });
      return;
    }

    const chave = `${unidadeResultado.codigo}|${data.toISOString().slice(0, 10)}`;
    const atual = somaPorChave.get(chave);
    if (atual) {
      atual.valor += valor;
    } else {
      somaPorChave.set(chave, { unidade: unidadeResultado.codigo, data, valor });
    }
  });

  const registros: RegistroBase[] = [...somaPorChave.values()].map((r, idx) => ({
    unidade: r.unidade,
    data: r.data,
    valor: Math.round(r.valor * 100) / 100,
    extras: {},
    linhaOrigem: idx, // registro agregado — não corresponde a uma única linha de origem
  }));

  return { registros, rejeitados };
}
