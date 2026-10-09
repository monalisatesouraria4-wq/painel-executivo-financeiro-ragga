import { between, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { unidades, troco } from "@/lib/db/schema";
import { semanaAnteriorISO, semanaRealISO, type TrocoSemanalDados } from "./trocoSemanal";

/**
 * Consulta da aba Troco (somente leitura; específica da aba — não altera nem reutiliza as consultas de outras abas).
 * Devolve as linhas da SEMANA REAL (segunda a domingo) escolhida e da semana anterior, de todas as lojas, mais a
 * última data com registro na base. Sem D-2. A semana escolhida é a que contém `referencia`; sem `referencia`, a da
 * última data com registro (a aba abre na última semana com dados).
 */
const data = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export async function buscarTrocoSemanalNoBanco(referencia: string | null): Promise<TrocoSemanalDados> {
  if (!process.env.DATABASE_URL) return { conectado: false, ultimaData: null, semana: null, linhas: [] };
  const db = getDb();
  const [{ max }] = await db.select({ max: sql<string | null>`max(${troco.data})::text` }).from(troco);
  const ultimaData = max ?? null;
  const base = referencia ?? ultimaData;
  if (!base) return { conectado: true, ultimaData, semana: null, linhas: [] };
  const semana = semanaRealISO(base);
  const anterior = semanaAnteriorISO(semana.inicio);
  const rows = await db
    .select({
      unidade: unidades.codigo,
      caixa: troco.caixa,
      data: sql<string>`${troco.data}::text`,
      conferido: troco.trocoConferidoGerente,
      informado: troco.trocoInformadoColaborador,
      diferenca: troco.diferenca,
      operador: troco.operador,
      planoDeAcao: troco.planoDeAcao,
    })
    .from(troco)
    .innerJoin(unidades, eq(troco.unidadeId, unidades.id))
    .where(between(troco.data, data(anterior.inicio), data(semana.fim)));
  return {
    conectado: true,
    ultimaData,
    semana,
    linhas: rows.map((r) => ({
      unidade: r.unidade as string,
      caixa: r.caixa,
      data: r.data,
      conferido: Number(r.conferido),
      informado: Number(r.informado),
      diferenca: Number(r.diferenca),
      operador: r.operador,
      planoDeAcao: r.planoDeAcao,
    })),
  };
}
