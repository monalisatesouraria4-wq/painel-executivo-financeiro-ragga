import { localizarColuna } from "./localizarColuna";
import { parseDataCelula } from "./parseCelula";
import { numerarOcorrenciasQuebra } from "./ocorrenciaQuebra";
import { parseQuebraCaixa } from "./parsers/quebraCaixa";
import { classificarLancamentosQuebra, type SituacaoLancamentoQuebra } from "./periodoAbaQuebra";
import { resolverAbaQuebraPorData, type AbaQuebraBruta, type AbaQuebraInvalida } from "./resolverAbaQuebra";
import type { AbaPeriodo } from "../rules/resolverAba";
import type { RegistroBase, ResultadoParse } from "./tipos";

/**
 * Leitura da planilha de Quebra de Caixa (módulo único usado pela tela de importação e pelo comando `atualizar-bases`):
 * resolve a aba, lê TODAS as linhas dela e aceita cada lançamento pela SUA data real (ver `periodoAbaQuebra.ts`).
 * Nenhum lançamento é descartado em silêncio: o que não entra volta em `parse.rejeitados` com linha e motivo.
 */
export interface QuebraLida {
  ok: true;
  aba: AbaPeriodo;
  criterio: "ciclo" | "cobertura_estendida" | undefined;
  abasInvalidas: AbaQuebraInvalida[];
  /** Só os registros ACEITOS (e os rejeitados: do parser + de data fora do ciclo), prontos para persistir/comparar. */
  parse: ResultadoParse;
  /** Situação de cada registro aceito (mesma ordem de `parse.registros`). */
  situacoes: SituacaoLancamentoQuebra[];
}
export type QuebraNaoLida = { ok: false; erro: "NENHUMA_ABA_CORRESPONDE" | "ABAS_AMBIGUAS"; abasInvalidas: AbaQuebraInvalida[]; abasConflitantes?: AbaPeriodo[] };

export function lerQuebraDaPlanilha(sheets: Record<string, unknown[][]>, dataReferencia: Date): QuebraLida | QuebraNaoLida {
  const abasBrutas: AbaQuebraBruta[] = Object.entries(sheets).map(([nomeAba, linhas]) => {
    const cabecalho = linhas[3] ?? []; // linha 4 — cabeçalho real das abas de Quebra
    const idxData = localizarColuna(cabecalho, "DATA");
    const idxLoja = localizarColuna(cabecalho, "LOJA");
    const datas: Date[] = [];
    for (const linha of linhas.slice(4)) {
      const loja = linha[idxLoja];
      if (loja === null || loja === undefined || loja === "") continue;
      const d = parseDataCelula(linha[idxData]);
      if (d) datas.push(d);
    }
    return { nomeAba, datasLancamentos: datas };
  });

  const r = resolverAbaQuebraPorData(dataReferencia, abasBrutas);
  if (!r.resultado.ok) {
    return r.resultado.erro === "ABAS_AMBIGUAS"
      ? { ok: false, erro: "ABAS_AMBIGUAS", abasInvalidas: r.abasInvalidas, abasConflitantes: r.resultado.abasConflitantes }
      : { ok: false, erro: "NENHUMA_ABA_CORRESPONDE", abasInvalidas: r.abasInvalidas };
  }
  const aba = r.resultado.aba;
  const linhas = sheets[aba.nomeAba] ?? [];
  const bruto = parseQuebraCaixa(linhas[3] ?? [], linhas.slice(4));
  const { aceitos, rejeitados } = classificarLancamentosQuebra<RegistroBase>(bruto.registros, aba.periodoInicio, aba.periodoFim);
  return {
    ok: true,
    aba,
    criterio: r.criterio,
    abasInvalidas: r.abasInvalidas,
    // cada lançamento aceito recebe seu nº de ocorrência (nenhum é somado a outro nem descartado)
    parse: { registros: numerarOcorrenciasQuebra(aceitos.map((a) => a.registro)), rejeitados: [...bruto.rejeitados, ...rejeitados] },
    situacoes: aceitos.map((a) => a.situacao),
  };
}
