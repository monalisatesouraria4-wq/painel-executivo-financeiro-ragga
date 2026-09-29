"use server";

import type { BaseId } from "@/lib/services/atualizacaoBases";
import type { RegistroBase } from "@/lib/import/tipos";
import {
  persistirFaturamento,
  persistirBrindes,
  persistirCancelamentoSalao,
  persistirCancelamentoDelivery,
  persistirCompraDireta,
  persistirRetiradaDeposito,
  persistirFechamento,
  persistirPdvMaquininha,
  persistirTroco,
  persistirConferencia,
  persistirQuebraCaixa,
  type ResultadoPersistencia,
  type FonteConferencia,
  type FonteQuebraCaixa,
} from "@/lib/db/persistencia";

/**
 * Server Action — única ponte entre a Atualização de Bases (client
 * component, lê o arquivo no navegador) e o Postgres. `lib/db/client.ts`
 * e o driver `postgres` são Node-only; sem esta fronteira "use server",
 * o bundler tentaria incluir esse código no bundle do navegador (erro
 * real de build encontrado e corrigido nesta etapa — `net`/`tls`/
 * `perf_hooks` não existem no browser).
 */
export async function persistirBaseNoBanco(
  id: BaseId,
  registros: RegistroBase[],
  fonteConferencia?: FonteConferencia,
  fonteQuebraCaixa?: FonteQuebraCaixa
): Promise<ResultadoPersistencia | null> {
  // Checagem do lado do servidor — aqui `process.env.DATABASE_URL` é a
  // variável real do processo Node, diferente de checar no client
  // component (sempre `undefined` lá, mesmo com banco configurado).
  if (!process.env.DATABASE_URL) return null;

  switch (id) {
    case "faturamento":
      return persistirFaturamento(registros);
    case "brindes":
      return persistirBrindes(registros);
    case "cancelamentoSalao":
      return persistirCancelamentoSalao(registros);
    case "cancelamentoDelivery":
      return persistirCancelamentoDelivery(registros);
    case "compraDireta":
      return persistirCompraDireta(registros);
    case "retiradaDeposito":
      return persistirRetiradaDeposito(registros);
    case "fechamento":
      return persistirFechamento(registros);
    case "pdvMaquininha":
      return persistirPdvMaquininha(registros);
    case "troco":
      return persistirTroco(registros);
    case "conferencia":
      return fonteConferencia ? persistirConferencia(registros, fonteConferencia) : null;
    case "quebraCaixa":
      return fonteQuebraCaixa ? persistirQuebraCaixa(registros, fonteQuebraCaixa) : null;
    default:
      return null;
  }
}
