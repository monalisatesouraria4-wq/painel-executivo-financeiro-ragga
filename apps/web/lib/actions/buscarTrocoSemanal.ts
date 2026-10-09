"use server";

import { buscarTrocoSemanalNoBanco } from "@/lib/services/trocoSemanal.server";
import type { TrocoSemanalDados } from "@/lib/services/trocoSemanal";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Server Action — Troco semanal (semana real seg–dom + semana anterior). `referencia` nula = última semana com registro. */
export async function buscarTrocoSemanal(referencia: string | null): Promise<TrocoSemanalDados> {
  const ref = referencia && ISO.test(referencia) ? referencia : null;
  return buscarTrocoSemanalNoBanco(ref);
}
