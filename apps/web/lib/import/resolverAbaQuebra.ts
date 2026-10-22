import { resolverAba, type AbaPeriodo, type ResolverAbaResultado } from "../rules/resolverAba";
import { extrairPeriodoDaAbaQuebra } from "./periodoAbaQuebra";

export interface AbaQuebraBruta {
  nomeAba: string;
  /** Datas já parseadas das linhas com LOJA preenchida (coluna DATA, cabeçalho na linha 4). */
  datasLancamentos: Date[];
}

export interface AbaQuebraInvalida {
  nomeAba: string;
  motivo: string;
}

export interface ResultadoResolucaoQuebra {
  resultado: ResolverAbaResultado;
  /** Abas do arquivo cuja estrutura não corresponde a uma Quebra de Caixa válida — nunca usadas, apenas reportadas. */
  abasInvalidas: AbaQuebraInvalida[];
  /** Abas válidas efetivamente consideradas na resolução (para auditoria/relatório). */
  abasValidas: AbaPeriodo[];
  /** "ciclo" = a referência está no ciclo 16→15 da aba; "cobertura_estendida" = só no ciclo da última data lançada na aba. */
  criterio?: "ciclo" | "cobertura_estendida";
}

/**
 * Resolve, a partir de TODAS as abas de um arquivo de Quebra de Caixa, qual delas cobre a data de referência — sem depender
 * do nome da aba, sem aba fixa, sem assumir que o período atual é a última.
 *
 * 1) Primeiro critério: a referência está no CICLO 16→15 da aba (ciclo da menor data de lançamento).
 * 2) Só se nenhuma aba atender, segundo critério: a referência está na COBERTURA ESTENDIDA (até o fim do ciclo da última data
 *    lançada na aba) — é o caso da aba "16-09 A 15-10" que recebeu lançamentos de 16 a 18/10: a referência 19/10 pertence ao
 *    ciclo desses lançamentos. Nunca escolhe um ciclo ANTERIOR automaticamente.
 * Mais de uma aba no mesmo critério → ambíguo (decisão do usuário).
 */
export function resolverAbaQuebraPorData(dataReferencia: Date, abasBrutas: AbaQuebraBruta[]): ResultadoResolucaoQuebra {
  const abasValidas: AbaPeriodo[] = [];
  const estendidas: AbaPeriodo[] = [];
  const abasInvalidas: AbaQuebraInvalida[] = [];

  for (const aba of abasBrutas) {
    const periodo = extrairPeriodoDaAbaQuebra(aba.datasLancamentos);
    if (periodo.valida) {
      abasValidas.push({ id: aba.nomeAba, nomeAba: aba.nomeAba, periodoInicio: periodo.periodoInicio, periodoFim: periodo.periodoFim });
      estendidas.push({ id: aba.nomeAba, nomeAba: aba.nomeAba, periodoInicio: periodo.periodoInicio, periodoFim: periodo.coberturaAte });
    } else {
      abasInvalidas.push({ nomeAba: aba.nomeAba, motivo: periodo.motivo });
    }
  }

  const primeiro = resolverAba(dataReferencia, abasValidas);
  if (primeiro.ok || primeiro.erro === "ABAS_AMBIGUAS") return { resultado: primeiro, abasInvalidas, abasValidas, criterio: "ciclo" };

  const segundo = resolverAba(dataReferencia, estendidas);
  if (segundo.ok) {
    const original = abasValidas.find((a) => a.id === segundo.aba.id)!; // o período registrado continua sendo o ciclo da aba
    return { resultado: { ok: true, aba: original }, abasInvalidas, abasValidas, criterio: "cobertura_estendida" };
  }
  return { resultado: segundo, abasInvalidas, abasValidas };
}
