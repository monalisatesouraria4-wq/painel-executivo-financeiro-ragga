"use server";

import { atualizarTratativa as atualizarTratativaNoBanco } from "@/lib/db/persistencia";
import type { AtualizarTratativaInput } from "@/lib/services/planoAcao";

/** Server Action — atualiza status/responsável/prazo/observação de uma tratativa. Sem `DATABASE_URL`: no-op. */
export async function atualizarTratativa(input: AtualizarTratativaInput): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await atualizarTratativaNoBanco(input);
}
