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
/**
 * Regras oficiais de agrupamento (a descrição ORIGINAL continua guardada em `formas_pagamento.forma`; a consolidação acontece só aqui,
 * na apresentação, e cada lançamento cai em UMA única categoria):
 *  - CRÉDITO  = CARTAO CREDITO + TEF - CREDITO
 *  - DÉBITO   = CARTAO DEBITO + TEF - DEBITO
 *  - PIX      = PIX MAQUININHA + TEF - PIX
 *  - VOUCHER  = VOUCHER + TEF - VOUCHER
 *  - ONLINE   = Pagamento online + Cupom de desconto (Pago pelo iFood)
 * A chave é comparada sem diferença de maiúsculas/minúsculas, acentos nem espaços sobrando (ver `normalizarForma`).
 */
const MAPA_FORMA_PARA_BUCKET: Record<string, keyof FormaPagamentoBuckets> = {
  "CARTAO CREDITO": "credito",
  "TEF - CREDITO": "credito",
  "CARTAO DEBITO": "debito",
  "TEF - DEBITO": "debito",
  "PIX MAQUININHA": "pix",
  "TEF - PIX": "pix",
  VOUCHER: "voucher",
  "TEF - VOUCHER": "voucher",
  "VENDA A PRAZO": "vendaAPrazo",
  "PAGAMENTO ONLINE": "online",
  "CUPOM DE DESCONTO (PAGO PELO IFOOD)": "online",
  DINHEIRO: "dinheiro",
};

/** Forma de comparação: sem acentos, maiúsculas, espaços das pontas removidos, espaços repetidos reduzidos e hífen com um espaço de cada lado. */
export function normalizarForma(formaRaw: string): string {
  return formaRaw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim();
}

export function classificarFormaPagamento(formaRaw: string): keyof FormaPagamentoBuckets {
  return MAPA_FORMA_PARA_BUCKET[normalizarForma(formaRaw)] ?? "outros";
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
