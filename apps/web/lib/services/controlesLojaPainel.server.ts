import { and, between, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { unidades, pdvMaquininha } from "@/lib/db/schema";
import type { PdvFormaBruta } from "./controlesLojaPainel";

/**
 * Detalhe por forma de pagamento do PDV × Maquininha (expansão da loja). Mesma tabela e mesmo filtro de datas de
 * `buscarPdvMaquininhaDoIntervalo` (as datas são as que o chamador envia, sem deslocamento aqui) — só que SEM somar por
 * loja, agrupando por loja + forma. `formas` (opcional) restringe às formas informadas. Nenhuma regra de cálculo
 * alterada; Σ formas = total da loja.
 */
export async function buscarPdvPorForma(inicio: Date, fim: Date, formas?: readonly string[]): Promise<PdvFormaBruta[]> {
  if (!process.env.DATABASE_URL) return [];
  const db = getDb();
  const rows = await db
    .select({
      codigo: unidades.codigo,
      forma: pdvMaquininha.formaPagamento,
      valorPdv: pdvMaquininha.valorPdv,
      valorMaquininha: pdvMaquininha.valorMaquininha,
    })
    .from(pdvMaquininha)
    .innerJoin(unidades, eq(pdvMaquininha.unidadeId, unidades.id))
    .where(and(between(pdvMaquininha.data, inicio, fim), formas && formas.length > 0 ? inArray(pdvMaquininha.formaPagamento, [...formas]) : undefined));
  return rows.map((r) => ({ unidade: r.codigo, forma: r.forma, valorPdv: Number(r.valorPdv), valorMaquininha: Number(r.valorMaquininha) }));
}
