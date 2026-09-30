"use server";

import { and, between, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { unidades, retiradaDeposito } from "@/lib/db/schema";
import { dataDeDeposito, inicioCicloDeposito } from "@/lib/rules/deposito";
import { rotuloDepositoEsperado } from "@/lib/services/retiradaDeposito";
import type { RetiradaDepositoPersonalizadoData, RetiradaDepositoPersonalizadoLinha } from "@/lib/services/retiradaDeposito";
import type { CodigoUnidade } from "@painel/shared";

/**
 * Server Action — modo "Personalizado" de Retirada para Depósito.
 * Chamada direto pelo client component (`RetiradaDepositoTab.tsx`) na
 * troca de data; precisa da fronteira "use server" pelo mesmo motivo já
 * documentado em `lib/actions/persistirBase.ts` (driver Postgres é
 * Node-only).
 *
 * Cada ciclo (`inicioCicloDeposito`, já validada/testada) é somado por
 * inteiro numa linha própria — nunca soma ciclos diferentes juntos,
 * confirmado no legado.
 */
export async function buscarRetiradaDepositoPersonalizado(
  inicio: Date,
  fim: Date,
  unidadeFiltro?: CodigoUnidade
): Promise<RetiradaDepositoPersonalizadoData> {
  const conectado = Boolean(process.env.DATABASE_URL);
  if (!conectado) return { conectado, disponivel: false, linhas: [] };

  const db = getDb();

  let unidadeId: string | undefined;
  if (unidadeFiltro) {
    const [linha] = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.codigo, unidadeFiltro));
    unidadeId = linha?.id;
    if (!unidadeId) return { conectado, disponivel: true, linhas: [] }; // loja desconhecida — nunca inventa dado
  }

  const linhas = await db
    .select({ codigo: unidades.codigo, data: retiradaDeposito.data, valor: retiradaDeposito.valor })
    .from(retiradaDeposito)
    .innerJoin(unidades, eq(retiradaDeposito.unidadeId, unidades.id))
    .where(
      unidadeId
        ? and(eq(retiradaDeposito.motivo, "DEPÓSITO"), between(retiradaDeposito.data, inicio, fim), eq(retiradaDeposito.unidadeId, unidadeId))
        : and(eq(retiradaDeposito.motivo, "DEPÓSITO"), between(retiradaDeposito.data, inicio, fim))
    );

  const porCiclo = new Map<string, { unidade: CodigoUnidade; inicioCiclo: Date; total: number }>();
  for (const linha of linhas) {
    const inicioCiclo = inicioCicloDeposito(linha.data);
    const chave = `${linha.codigo}|${inicioCiclo.toISOString().slice(0, 10)}`;
    const atual = porCiclo.get(chave);
    if (atual) atual.total += Number(linha.valor);
    else porCiclo.set(chave, { unidade: linha.codigo as CodigoUnidade, inicioCiclo, total: Number(linha.valor) });
  }

  const resultado: RetiradaDepositoPersonalizadoLinha[] = [...porCiclo.values()]
    .sort((a, b) => a.inicioCiclo.getTime() - b.inicioCiclo.getTime())
    .map((c) => ({
      unidade: c.unidade,
      cicloLabel: rotuloDepositoEsperado(dataDeDeposito(c.inicioCiclo).getUTCDay()),
      retiradaCiclo: c.total,
      depositoEsperadoLabel: rotuloDepositoEsperado(dataDeDeposito(c.inicioCiclo).getUTCDay()),
    }));

  return { conectado, disponivel: true, linhas: resultado };
}
