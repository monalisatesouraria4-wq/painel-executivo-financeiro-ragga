"use server";

import { criarTratativa as criarTratativaNoBanco } from "@/lib/db/persistencia";
import type { NovaTratativaInput } from "@/lib/services/planoAcao";

/** Server Action — cria uma tratativa (Plano de Ação). Sem `DATABASE_URL`: no-op. */
export async function criarTratativa(input: NovaTratativaInput): Promise<{ id: string } | null> {
  if (!process.env.DATABASE_URL) return null;
  return criarTratativaNoBanco(input);
}
