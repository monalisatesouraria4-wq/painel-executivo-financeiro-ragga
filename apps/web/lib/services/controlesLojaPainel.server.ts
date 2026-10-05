import { between, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { unidades, pdvMaquininha } from "@/lib/db/schema";
import type { PdvFormaBruta } from "./controlesLojaPainel";

/**
 * Detalhe por forma de pagamento do PDV × Maquininha (expansão da loja). Mesma tabela e mesmo filtro de datas de
 * `buscarPdvMaquininhaDoIntervalo` (as datas já chegam deslocadas D-2 pelo chamador) — só que SEM somar por loja,
 * agrupando por loja + forma. Nenhuma regra de cálculo alterada; Σ formas = total da loja.
 */
export async function buscarPdvPorForma(inicio: Date, fim: Date): Promise<PdvFormaBruta[]> {
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
    .where(between(pdvMaquininha.data, inicio, fim));
  return rows.map((r) => ({ unidade: r.codigo, forma: r.forma, valorPdv: Number(r.valorPdv), valorMaquininha: Number(r.valorMaquininha) }));
}
