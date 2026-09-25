import { resolverAba, type AbaPeriodo, type ResolverAbaResultado } from "../rules/resolverAba";
import { extrairPeriodoDaAbaConferencia } from "./periodoAbaConferencia";

export interface AbaConferenciaBruta {
  nomeAba: string;
  /** Valores da linha 6 da aba, a partir da coluna de dado (ver periodoAbaConferencia.ts). */
  celulasLinhaDeDatas: unknown[];
}

export interface AbaConferenciaInvalida {
  nomeAba: string;
  motivo: string;
}

export interface ResultadoResolucaoConferencia {
  resultado: ResolverAbaResultado;
  /** Abas do arquivo cuja estrutura não corresponde a uma Conferência válida — nunca usadas, apenas reportadas. */
  abasInvalidas: AbaConferenciaInvalida[];
  /** Abas válidas efetivamente consideradas na resolução (para auditoria/relatório). */
  abasValidas: AbaPeriodo[];
}

/**
 * Resolve, a partir de TODAS as abas de um arquivo de Conferência, qual
 * delas cobre a data de referência informada — sem depender do nome do
 * arquivo, sem aba fixa, sem assumir que o período atual é o último, e
 * sem tentar corrigir abas com estrutura fora do padrão (planejamento
 * v3). O ano de cada período vem das datas reais da própria aba (ver
 * periodoAbaConferencia.ts), nunca de uma inferência sobre o nome.
 */
export function resolverAbaConferenciaPorData(
  dataReferencia: Date,
  abasBrutas: AbaConferenciaBruta[]
): ResultadoResolucaoConferencia {
  const abasValidas: AbaPeriodo[] = [];
  const abasInvalidas: AbaConferenciaInvalida[] = [];

  for (const aba of abasBrutas) {
    const periodo = extrairPeriodoDaAbaConferencia(aba.celulasLinhaDeDatas);
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
