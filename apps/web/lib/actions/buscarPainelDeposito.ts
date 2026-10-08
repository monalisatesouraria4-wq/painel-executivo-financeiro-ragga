"use server";

import { UNIDADES } from "@painel/shared";
import { buscarCoberturaDeposito, buscarLancamentosDeposito } from "@/lib/services/retiradaDepositoPainel.server";
import type { CoberturaDeposito, LancamentoDeposito } from "@/lib/services/retiradaDepositoAnalise";

export interface PainelDepositoDados {
  conectado: boolean;
  cobertura: CoberturaDeposito;
  /** Lançamentos DEPÓSITO de `inicio` a `fim` (cobre o período anterior e o selecionado). */
  lancamentos: LancamentoDeposito[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Server Action — painel de Retirada para Depósito: lançamentos DEPÓSITO do intervalo + cobertura real da base (só leitura). */
export async function buscarPainelDeposito(inicio: string, fim: string, unidade?: string): Promise<PainelDepositoDados> {
  const cobertura = await buscarCoberturaDeposito();
  const valido = ISO.test(inicio) && ISO.test(fim) && inicio <= fim && (!unidade || (UNIDADES as readonly string[]).includes(unidade));
  if (!cobertura.conectado || !valido) return { conectado: cobertura.conectado, cobertura, lancamentos: [] };
  return { conectado: true, cobertura, lancamentos: await buscarLancamentosDeposito(inicio, fim, unidade) };
}
