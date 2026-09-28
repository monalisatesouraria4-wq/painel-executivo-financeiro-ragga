import { normalizarUnidade } from "../normalizarUnidade";
import { parseDataCelula, parseValorCelula, parseTextoCelula } from "../parseCelula";
import { localizarColuna, localizarColunaExata } from "../localizarColuna";
import type { ResultadoParse, RegistroBase } from "../tipos";

/**
 * Parser de Formas de Pagamento. Não existe planilha própria para esta
 * base (investigado — ver docs/regras-negocio.md): a fonte é a MESMA do
 * Faturamento (`FATURAMENTO - 1 SEMESTRE 2026.xlsx`), agregada por
 * Filial + Data + `Desc. pagam.` (em vez de só Filial + Data).
 *
 * Regra (confirmada pelo usuário): `SUM(Vl. pagamento)` agrupado por
 * Filial + Data + Forma. Mesma leitura de linha do parser de
 * Faturamento — sem exclusão de cancelamento/negativos (mesma fonte,
 * mesma limitação de informação já documentada).
 */
export function parseFormasPagamento(cabecalho: unknown[], linhas: unknown[][]): ResultadoParse {
  const idxFilial = localizarColunaExata(cabecalho, "FILIAL");
  const idxData = localizarColunaExata(cabecalho, "DATA");
  const idxValor = localizarColuna(cabecalho, "VL. PAGAMENTO");
  const idxForma = localizarColuna(cabecalho, "DESC. PAGAM.");

  const rejeitados: ResultadoParse["rejeitados"] = [];
  const somaPorChave = new Map<
    string,
    { unidade: RegistroBase["unidade"]; data: Date; forma: string; valor: number }
  >();

  linhas.forEach((linha, i) => {
    const linhaOrigem = i + 2;
    const vazio = linha.every((v) => v === null || v === undefined || v === "");
    if (vazio) return;

    const valoresBrutos: Record<string, unknown> = {
      FILIAL: linha[idxFilial],
      DATA: linha[idxData],
      "VL. PAGAMENTO": linha[idxValor],
      "DESC. PAGAM.": idxForma >= 0 ? linha[idxForma] : undefined,
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

    const forma = idxForma >= 0 ? parseTextoCelula(linha[idxForma]) : "";
    if (!forma) {
      rejeitados.push({ linhaOrigem, motivo: "Desc. pagam. vazia", valoresBrutos });
      return;
    }

    const chave = `${unidadeResultado.codigo}|${data.toISOString().slice(0, 10)}|${forma}`;
    const atual = somaPorChave.get(chave);
    if (atual) {
      atual.valor += valor;
    } else {
      somaPorChave.set(chave, { unidade: unidadeResultado.codigo, data, forma, valor });
    }
  });

  const registros: RegistroBase[] = [...somaPorChave.values()].map((r, idx) => ({
    unidade: r.unidade,
    data: r.data,
    valor: Math.round(r.valor * 100) / 100,
    extras: { forma: r.forma },
    linhaOrigem: idx, // registro agregado — não corresponde a uma única linha de origem
  }));

  return { registros, rejeitados };
}
