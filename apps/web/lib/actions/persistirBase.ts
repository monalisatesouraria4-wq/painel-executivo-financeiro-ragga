"use server";

import type { BaseId } from "@/lib/services/atualizacaoBases";
import { baseSnapshot } from "@/lib/import/basesSnapshot";
import type { RegistroBase } from "@/lib/import/tipos";
import {
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

  // Bases com sincronização autoritativa NÃO podem ser gravadas por este upsert antigo (ele deixaria registros antigos somados):
  // a única via é `lib/actions/sincronizacaoBases.ts` (simulação → aprovação por hash → backup → transação).
  if (baseSnapshot(id)) {
    throw new Error(`A base "${id}" usa a sincronização autoritativa: grave pela prévia de sincronização, não pelo upsert direto.`);
  }

  switch (id) {
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
