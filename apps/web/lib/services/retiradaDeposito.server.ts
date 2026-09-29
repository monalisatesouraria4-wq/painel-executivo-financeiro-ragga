import { and, between, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { unidades, retiradaDeposito } from "@/lib/db/schema";
import { dataDMenos1 } from "@/lib/rules/datas";
import { dataDeDeposito, inicioCicloDeposito } from "@/lib/rules/deposito";
import type { RetiradaDepositoDiaData, RetiradaDepositoDiaLinha, BannerRetiradaDia } from "./retiradaDeposito";
import { rotuloDepositoEsperado } from "./retiradaDeposito";

/**
 * Consulta real ao Postgres para "Retirada para Depósito" — modo Dia.
 * Só importado pela Server Component da página (ver nota em
 * `retiradaDeposito.ts`). Filtro `motivo = 'DEPÓSITO'` (corrigido nesta
 * etapa — literal sem acento nunca batia com o valor persistido).
 */
export async function buscarRetiradaDepositoDia(dataReferencia: Date): Promise<RetiradaDepositoDiaData> {
  const conectado = Boolean(process.env.DATABASE_URL);
  const d1 = dataDMenos1(dataReferencia);

  const base: RetiradaDepositoDiaData = {
    conectado,
    disponivel: false,
    dataReferenciaD1: d1,
    banner: null,
    maxDataDisponivel: null,
    linhas: [],
  };

  if (!conectado) return base;

  const db = getDb();

  const [{ maxData }] = await db
    .select({ maxData: sql<string | null>`max(${retiradaDeposito.data})` })
    .from(retiradaDeposito)
    .where(eq(retiradaDeposito.motivo, "DEPÓSITO"));

  let banner: BannerRetiradaDia = null;
  if (!maxData) {
    banner = "base_vazia";
  } else {
    const max = new Date(maxData);
    if (max.getTime() < d1.getTime()) banner = "sem_dado";
    else if (max.getTime() === d1.getTime()) banner = "parcial";
  }

  const inicioCiclo = inicioCicloDeposito(d1);

  const [diaRows, cicloRows] = await Promise.all([
    db
      .select({ codigo: unidades.codigo, total: sql<string>`sum(${retiradaDeposito.valor})` })
      .from(retiradaDeposito)
      .innerJoin(unidades, eq(retiradaDeposito.unidadeId, unidades.id))
      .where(and(eq(retiradaDeposito.motivo, "DEPÓSITO"), eq(retiradaDeposito.data, d1)))
      .groupBy(unidades.codigo),
    db
      .select({ codigo: unidades.codigo, total: sql<string>`sum(${retiradaDeposito.valor})` })
      .from(retiradaDeposito)
      .innerJoin(unidades, eq(retiradaDeposito.unidadeId, unidades.id))
      .where(and(eq(retiradaDeposito.motivo, "DEPÓSITO"), between(retiradaDeposito.data, inicioCiclo, d1)))
      .groupBy(unidades.codigo),
  ]);

  const diaPorLoja = new Map(diaRows.map((r) => [r.codigo, Number(r.total)]));
  const cicloPorLoja = new Map(cicloRows.map((r) => [r.codigo, Number(r.total)]));
  const cicloLabel = rotuloDepositoEsperado(dataDeDeposito(d1).getUTCDay());

  const codigos = new Set([...diaPorLoja.keys(), ...cicloPorLoja.keys()]);
  const linhas: RetiradaDepositoDiaLinha[] = [...codigos].map((unidade) => ({
    unidade: unidade as RetiradaDepositoDiaLinha["unidade"],
    retiradaDia: diaPorLoja.get(unidade) ?? 0,
    acumuladoCiclo: cicloPorLoja.get(unidade) ?? 0,
    cicloLabel,
  }));

  return { ...base, disponivel: true, banner, maxDataDisponivel: maxData ? new Date(maxData) : null, linhas };
}
