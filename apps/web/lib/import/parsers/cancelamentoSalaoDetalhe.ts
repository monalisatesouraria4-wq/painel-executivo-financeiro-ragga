import type { CodigoUnidade } from "@painel/shared";
import { normalizarUnidade } from "../normalizarUnidade";
import { parseValorCelula, parseTextoCelula } from "../parseCelula";
import { localizarColuna, localizarColunaExata } from "../localizarColuna";
import { dataOperacionalDoEstorno, estornoNaJanelaMadrugada } from "../../rules/cancelamentoMadrugada";

/**
 * Detalhe INDIVIDUAL dos estornos do Cancelamento Salão (uma linha da planilha = um item estornado). É um parser
 * ADICIONAL: o agregado por loja + data + motivo (`parseListaSimples` / `cancelamento_salao`) continua exatamente como era.
 *
 * Colunas reais de `CANCEL SALÃO.xlsx`: Filial, Produto ("HH:MM - NOME"), Comanda, Qtde., Valor total, Data/hora estorno
 * ("DD/MM/AAAA HH:MM"), Atendente lançamento, Autorizador, Motivo, Justificativa.
 *
 * Idempotência: NÃO existe identificador único de estorno e a comanda se repete ao longo dos dias, então a chave é composta
 * por todos os campos do estorno + a OCORRÊNCIA (ordem entre linhas idênticas no mesmo arquivo: 1, 2, 3…). Reimportar o mesmo
 * arquivo gera as mesmas chaves (nada duplica) e ocorrências legítimas repetidas (mesmo item, mesmo minuto) são preservadas.
 */

export interface DetalheCancelamentoSalao {
  unidade: CodigoUnidade;
  /** "AAAA-MM-DD HH:MM:00" exatamente como na planilha (sem fuso). */
  estornoEm: string;
  dataCalendario: string;
  dataOperacional: string;
  minutoDoDia: number;
  /** Dentro da janela 00h31–05h59. */
  madrugada: boolean;
  comanda: string;
  produto: string;
  quantidade: number;
  valor: number;
  motivo: string;
  justificativa: string;
  atendente: string;
  autorizador: string;
  /** Ordem entre linhas idênticas (mesma chave natural) no arquivo, começando em 1. */
  ocorrencia: number;
  linhaOrigem: number;
}

export interface RejeicaoDetalhe {
  linhaOrigem: number;
  motivo: string;
}

export interface ResultadoParseDetalhe {
  registros: DetalheCancelamentoSalao[];
  rejeitados: RejeicaoDetalhe[];
}

const RE_DATA_HORA = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?$/;
const dois = (n: number) => String(n).padStart(2, "0");

/** Data/hora do estorno como gravada na planilha: texto "DD/MM/AAAA HH:MM" ou objeto Date (campos UTC = valor digitado). */
export function parseDataHoraEstorno(valor: unknown): { dataISO: string; hora: number; minuto: number } | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return { dataISO: valor.toISOString().slice(0, 10), hora: valor.getUTCHours(), minuto: valor.getUTCMinutes() };
  }
  if (typeof valor !== "string") return null;
  const m = RE_DATA_HORA.exec(valor.trim());
  if (!m) return null;
  const [dia, mes, ano, hora, minuto] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() + 1 !== mes || d.getUTCDate() !== dia) return null;
  return { dataISO: `${ano}-${dois(mes)}-${dois(dia)}`, hora, minuto };
}

/** Chave natural do estorno (sem a ocorrência). */
export function chaveNaturalDetalhe(d: Pick<DetalheCancelamentoSalao, "unidade" | "estornoEm" | "comanda" | "produto" | "quantidade" | "valor" | "motivo" | "atendente" | "autorizador">): string {
  return [d.unidade, d.estornoEm, d.comanda, d.produto, d.quantidade.toFixed(2), d.valor.toFixed(2), d.motivo, d.atendente, d.autorizador].join("|");
}
/** Chave completa (natural + ocorrência) = a mesma da restrição única do banco. */
export const chaveDetalhe = (d: Parameters<typeof chaveNaturalDetalhe>[0] & { ocorrencia: number }) => `${chaveNaturalDetalhe(d)}|${d.ocorrencia}`;

export function parseCancelamentoSalaoDetalhe(cabecalho: unknown[], linhas: unknown[][]): ResultadoParseDetalhe {
  const iLoja = localizarColuna(cabecalho, "FILIAL");
  const iProduto = localizarColuna(cabecalho, "PRODUTO");
  const iComanda = localizarColuna(cabecalho, "COMANDA");
  const iQtde = localizarColuna(cabecalho, "QTDE");
  const iValor = localizarColuna(cabecalho, "VALOR TOTAL");
  const iDataHora = localizarColuna(cabecalho, "DATA/HORA ESTORNO");
  const iAtendente = localizarColuna(cabecalho, "ATENDENTE");
  const iAutorizador = localizarColuna(cabecalho, "AUTORIZADOR");
  const iMotivo = localizarColunaExata(cabecalho, "MOTIVO");
  const iJustificativa = localizarColuna(cabecalho, "JUSTIFICATIVA");

  const resultado: ResultadoParseDetalhe = { registros: [], rejeitados: [] };
  const ocorrencias = new Map<string, number>();

  linhas.forEach((linha, i) => {
    const linhaOrigem = i + 2;
    if (linha.every((v) => v === null || v === undefined || v === "")) return;

    const unidade = normalizarUnidade(parseTextoCelula(linha[iLoja]));
    if (!unidade.ok) {
      resultado.rejeitados.push({ linhaOrigem, motivo: `Unidade não reconhecida: "${unidade.valorOriginal}"` });
      return;
    }
    const dh = parseDataHoraEstorno(linha[iDataHora]);
    if (!dh) {
      resultado.rejeitados.push({ linhaOrigem, motivo: `Data/hora do estorno inválida ou sem horário: "${String(linha[iDataHora])}"` });
      return;
    }
    const valor = parseValorCelula(linha[iValor]);
    if (valor === null) {
      resultado.rejeitados.push({ linhaOrigem, motivo: `Valor total inválido: "${String(linha[iValor])}"` });
      return;
    }
    const quantidade = parseValorCelula(linha[iQtde]) ?? 0;
    const minuto = dh.hora * 60 + dh.minuto;
    const base = {
      unidade: unidade.codigo,
      estornoEm: `${dh.dataISO} ${dois(dh.hora)}:${dois(dh.minuto)}:00`,
      comanda: parseTextoCelula(linha[iComanda]),
      produto: parseTextoCelula(linha[iProduto]),
      quantidade,
      valor,
      motivo: parseTextoCelula(linha[iMotivo]),
      atendente: parseTextoCelula(linha[iAtendente]),
      autorizador: parseTextoCelula(linha[iAutorizador]),
    };
    const chave = chaveNaturalDetalhe(base);
    const ocorrencia = (ocorrencias.get(chave) ?? 0) + 1;
    ocorrencias.set(chave, ocorrencia);
    resultado.registros.push({
      ...base,
      dataCalendario: dh.dataISO,
      dataOperacional: dataOperacionalDoEstorno(dh.dataISO, minuto),
      minutoDoDia: minuto,
      madrugada: estornoNaJanelaMadrugada(minuto),
      justificativa: parseTextoCelula(linha[iJustificativa]),
      ocorrencia,
      linhaOrigem,
    });
  });
  return resultado;
}
