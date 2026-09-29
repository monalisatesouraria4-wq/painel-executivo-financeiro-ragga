import type { FormaPagamentoBuckets } from "@/lib/services/fechamentoWhatsapp";

/**
 * Classificação de `Desc. pagam.` (texto bruto do VENDAS.xlsx, coluna já
 * persistida em `formas_pagamento.forma`) nas 8 categorias já usadas
 * pelo painel (Crédito/Débito/PIX/Voucher/Venda a Prazo/Online/Dinheiro/
 * Outros). Baseada nos 11 valores reais confirmados no arquivo
 * (PROJETO_RECEBIVEIS/01_VENDAS_CLOUDFY/VENDAS.xlsx, período 01/06 a
 * 27/09/2026) — a soma por categoria fecha exatamente com o total de
 * Faturamento do mesmo período (conferência feita antes de persistir).
 * Qualquer valor de `Desc. pagam.` não reconhecido cai em "Outros" —
 * nunca descartado silenciosamente.
 */
const MAPA_FORMA_PARA_BUCKET: Record<string, keyof FormaPagamentoBuckets> = {
  "CARTAO CREDITO": "credito",
  "TEF - CREDITO": "credito",
  "CARTAO DEBITO": "debito",
  "TEF - DEBITO": "debito",
  "PIX MAQUININHA": "pix",
  VOUCHER: "voucher",
  "TEF - VOUCHER": "voucher",
  "Venda a prazo": "vendaAPrazo",
  "Pagamento online": "online",
  "Cupom de desconto (Pago pelo iFood)": "online",
  DINHEIRO: "dinheiro",
};

export function classificarFormaPagamento(formaRaw: string): keyof FormaPagamentoBuckets {
  return MAPA_FORMA_PARA_BUCKET[formaRaw.trim()] ?? "outros";
}

export function bucketsVazios(): FormaPagamentoBuckets {
  return { credito: 0, debito: 0, pix: 0, voucher: 0, vendaAPrazo: 0, online: 0, dinheiro: 0, outros: 0 };
}

/** Agrega uma lista de {forma, valor} nos 8 buckets, usando `classificarFormaPagamento`. */
export function agregarEmBuckets(linhas: { forma: string; valor: number }[]): FormaPagamentoBuckets {
  const buckets = bucketsVazios();
  for (const l of linhas) {
    const bucket = classificarFormaPagamento(l.forma);
    buckets[bucket] += l.valor;
  }
  return buckets;
}
