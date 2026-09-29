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
}

/**
 * Resolve, a partir de TODAS as abas de um arquivo de Quebra de Caixa,
 * qual delas cobre a data de referência informada — sem depender do nome
 * do arquivo/aba, sem aba fixa, sem assumir que o período atual é o
 * último. Mesmo princípio de `resolverAbaConferenciaPorData`, resolvedor
 * independente (Conferência e Quebra de Caixa nunca compartilham o
 * resultado desta função, mesmo quando os períodos coincidem).
 */
export function resolverAbaQuebraPorData(
  dataReferencia: Date,
  abasBrutas: AbaQuebraBruta[]
): ResultadoResolucaoQuebra {
  const abasValidas: AbaPeriodo[] = [];
  const abasInvalidas: AbaQuebraInvalida[] = [];

  for (const aba of abasBrutas) {
    const periodo = extrairPeriodoDaAbaQuebra(aba.datasLancamentos);
    if (periodo.valida) {
      abasValidas.push({
        id: aba.nomeAba,
        nomeAba: aba.nomeAba,
        periodoInicio: periodo.periodoInicio,
        periodoFim: periodo.periodoFim,
      });
    } else {
      abasInvalidas.push({ nomeAba: aba.nomeAba, motivo: periodo.motivo });
    }
  }

  const resultado = resolverAba(dataReferencia, abasValidas);

  return { resultado, abasInvalidas, abasValidas };
}
