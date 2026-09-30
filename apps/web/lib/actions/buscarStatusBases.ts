"use server";

import { buscarStatusTodasAsBases, buscarStatusBase } from "@/lib/services/statusBases.server";
import type { StatusBase } from "@/lib/services/statusBases.server";
import type { BaseId } from "@/lib/services/atualizacaoBases";

/** Server Action — "período atualmente existente no banco" por base (item 7 da etapa de revisão). */
export async function buscarStatusBasesAction(): Promise<Record<BaseId, StatusBase>> {
  return buscarStatusTodasAsBases();
}

export async function buscarStatusBasePorId(id: BaseId): Promise<StatusBase> {
  return buscarStatusBase(id);
}
