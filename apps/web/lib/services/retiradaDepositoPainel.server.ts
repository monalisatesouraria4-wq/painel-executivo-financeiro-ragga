import { and, between, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { unidades, retiradaDeposito } from "@/lib/db/schema";
import { COBERTURA_VAZIA, type CoberturaDeposito, type LancamentoDeposito } from "./retiradaDepositoAnalise";

/**
 * Consultas do painel de Retirada para Depósito (só leitura; só importado por Server Actions/Server Components).
 * Indicador = SOMENTE `motivo = 'DEPÓSITO'` (o literal tem acento, como está persistido — mesmo filtro de
 * `buscarRetiradaDepositoPersonalizado` e da Visão Geral). ERRO e SUPRIMENTO entram apenas na cobertura (existência de
 * registro no dia), nunca nos valores. Usuário e autorizador NÃO são selecionados.
 */
const MOTIVO_DEPOSITO = "DEPÓSITO";
const data = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Cobertura real da tabela: intervalo (qualquer motivo e só DEPÓSITO), dias com registro e lojas com DEPÓSITO. */
export async function buscarCoberturaDeposito(): Promise<CoberturaDeposito> {
  if (!process.env.DATABASE_URL) return COBERTURA_VAZIA;
  const db = getDb();
  const [[faixa], dias, lojas] = await Promise.all([
    db
      .select({
        minBase: sql<string | null>`min(${retiradaDeposito.data})::text`,
        maxBase: sql<string | null>`max(${retiradaDeposito.data})::text`,
        minDeposito: sql<string | null>`(min(${retiradaDeposito.data}) filter (where ${retiradaDeposito.motivo} = ${MOTIVO_DEPOSITO}))::text`,
        maxDeposito: sql<string | null>`(max(${retiradaDeposito.data}) filter (where ${retiradaDeposito.motivo} = ${MOTIVO_DEPOSITO}))::text`,
      })
      .from(retiradaDeposito),
    db.selectDistinct({ d: sql<string>`${retiradaDeposito.data}::text` }).from(retiradaDeposito).orderBy(sql`1`),
    db
      .selectDistinct({ codigo: unidades.codigo })
      .from(retiradaDeposito)
      .innerJoin(unidades, eq(retiradaDeposito.unidadeId, unidades.id))
      .where(eq(retiradaDeposito.motivo, MOTIVO_DEPOSITO)),
  ]);
  return {
    conectado: true,
    minBase: faixa?.minBase ?? null,
    maxBase: faixa?.maxBase ?? null,
    minDeposito: faixa?.minDeposito ?? null,
    maxDeposito: faixa?.maxDeposito ?? null,
    diasComRegistro: dias.map((r) => r.d),
    lojasComDeposito: lojas.map((r) => r.codigo).sort(),
  };
}

/** Lançamentos DEPÓSITO entre `inicio` e `fim` (um por linha da base, sem agregação), opcionalmente de uma loja. */
export async function buscarLancamentosDeposito(inicio: string, fim: string, unidade?: string): Promise<LancamentoDeposito[]> {
  if (!process.env.DATABASE_URL) return [];
  const db = getDb();
  const filtros = [eq(retiradaDeposito.motivo, MOTIVO_DEPOSITO), between(retiradaDeposito.data, data(inicio), data(fim))];
  if (unidade) filtros.push(eq(unidades.codigo, unidade));
  const linhas = await db
    .select({ unidade: unidades.codigo, data: sql<string>`${retiradaDeposito.data}::text`, valor: retiradaDeposito.valor, caixa: retiradaDeposito.caixa, motivo: retiradaDeposito.motivo })
    .from(retiradaDeposito)
    .innerJoin(unidades, eq(retiradaDeposito.unidadeId, unidades.id))
    .where(and(...filtros));
  return linhas.map((l) => ({ unidade: l.unidade, data: l.data, valor: Number(l.valor), caixa: l.caixa, motivo: l.motivo }));
}
