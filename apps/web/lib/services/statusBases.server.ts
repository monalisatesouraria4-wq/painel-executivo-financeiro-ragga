import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  faturamento,
  brindes,
  cancelamentoSalao,
  cancelamentoDelivery,
  compraDireta,
  retiradaDeposito,
  fechamentoCaixa,
  pdvMaquininha,
  troco,
  conferencia,
  quebraCaixa,
} from "@/lib/db/schema";
import type { BaseId } from "./atualizacaoBases";

/**
 * "Período atualmente existente no banco" por base (item 7 da etapa de
 * revisão) — leitura pura (`min(data)`/`max(data)`/`count(*)`) de cada
 * tabela já existente, sem nenhuma regra nova. Usado só para exibir o
 * status real na tela de Atualização de Bases antes/depois do upload.
 */
export interface StatusBase {
  disponivel: boolean;
  periodoInicio: Date | null;
  periodoFim: Date | null;
  totalRegistros: number;
}

const TABELA_POR_BASE = {
  faturamento,
  brindes,
  cancelamentoSalao,
  cancelamentoDelivery,
  compraDireta,
  retiradaDeposito,
  fechamento: fechamentoCaixa,
  pdvMaquininha,
  troco,
  conferencia,
  quebraCaixa,
} as const;

export async function buscarStatusBase(id: BaseId): Promise<StatusBase> {
  if (!process.env.DATABASE_URL) return { disponivel: false, periodoInicio: null, periodoFim: null, totalRegistros: 0 };

  const db = getDb();
  const tabela = TABELA_POR_BASE[id];
  const [{ minData, maxData, total }] = await db
    .select({
      minData: sql<string | null>`min(${tabela.data})`,
      maxData: sql<string | null>`max(${tabela.data})`,
      total: sql<string>`count(*)`,
    })
    .from(tabela);

  return {
    disponivel: minData !== null,
    periodoInicio: minData ? new Date(minData) : null,
    periodoFim: maxData ? new Date(maxData) : null,
    totalRegistros: Number(total),
  };
}

export async function buscarStatusTodasAsBases(): Promise<Record<BaseId, StatusBase>> {
  const ids = Object.keys(TABELA_POR_BASE) as BaseId[];
  const resultados = await Promise.all(ids.map((id) => buscarStatusBase(id)));
  return Object.fromEntries(ids.map((id, i) => [id, resultados[i]])) as Record<BaseId, StatusBase>;
}
