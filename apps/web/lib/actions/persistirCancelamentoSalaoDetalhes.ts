"use server";

import { persistirCancelamentoSalaoDetalhes, type ResultadoPersistenciaDetalhes } from "@/lib/db/persistencia";
import type { DetalheCancelamentoSalao } from "@/lib/import/parsers/cancelamentoSalaoDetalhe";

/**
 * Server Action — grava (upsert idempotente) um LOTE de detalhes de estornos do Cancelamento Salão. O cliente envia em
 * lotes pequenos (limite de corpo das Server Actions); as ocorrências já vêm calculadas do arquivo inteiro.
 * Sem DATABASE_URL: `null` (nada gravado).
 */
export async function persistirDetalhesCancelamentoSalao(detalhes: DetalheCancelamentoSalao[]): Promise<ResultadoPersistenciaDetalhes | null> {
  if (!process.env.DATABASE_URL) return null;
  return persistirCancelamentoSalaoDetalhes(detalhes);
}
