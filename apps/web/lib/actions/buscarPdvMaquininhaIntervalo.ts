"use server";

import { getDb } from "@/lib/db/client";
import { buscarPdvMaquininhaIntervalo as buscarPdvMaquininhaIntervaloNoBanco } from "@/lib/services/controlesCaixa";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

/** Server Action — PDV × Maquininha com período personalizado (opcional, além da consulta D-2 padrão). */
export async function buscarPdvMaquininhaIntervalo(inicio: Date, fim: Date): Promise<ControlesCaixaData["pdvMaquininha"]> {
  if (!process.env.DATABASE_URL) return { disponivel: false, totalPdvRede: null, totalMaquininhaRede: null, diferencaRede: null, linhas: [] };
  return buscarPdvMaquininhaIntervaloNoBanco(getDb(), inicio, fim);
}
