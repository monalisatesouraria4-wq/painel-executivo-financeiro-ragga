import type { BaseId } from "@/lib/services/atualizacaoBases";

/**
 * Classifica as linhas REJEITADAS pelos parsers oficiais para o comando "atualizar base": separa o ruído conhecido da
 * planilha (linhas em branco formatadas, totais/legendas da Conferência, motivos fora do escopo da Retirada Depósito) das
 * rejeições que merecem decisão humana (data/valor inválido, unidade desconhecida com dado, caixa vazio etc.). Função PURA;
 * não altera nenhum parser nem regra de importação.
 */

export interface RejeicaoParaClassificar {
  linhaOrigem: number;
  motivo: string;
  valoresBrutos?: Record<string, unknown>;
}

export type ClasseRejeicao = "em-branco" | "estrutural" | "fora-de-escopo" | "aceita" | "atencao";

const vazio = (v: unknown) => v === null || v === undefined || v === "";

/** Assinatura estável de uma rejeição (base + motivo + valores brutos), usada na lista de rejeições já aceitas. */
export const assinaturaRejeicao = (base: BaseId, r: RejeicaoParaClassificar): string => `${base}|${r.motivo}|${JSON.stringify(r.valoresBrutos ?? {})}`;

export function classificarRejeicao(base: BaseId, r: RejeicaoParaClassificar, aceitas: readonly string[] = []): ClasseRejeicao {
  const valores = Object.values(r.valoresBrutos ?? {});
  if (valores.every(vazio)) return "em-branco";
  if (base === "retiradaDeposito" && /^Motivo = .* fora do escopo/.test(r.motivo)) return "fora-de-escopo";
  if ((base === "conferencia" || base === "quebraCaixa") && r.motivo.startsWith("Unidade não reconhecida")) {
    // totais, legendas e observações impressas nas abas por ciclo (ex.: "TOTAL DE CAIXAS", "Digite a quantidade…", "•")
    if (/TOTAL|DIGITE|•|LEGENDA|OBSERVA|MAPOLI:/i.test(r.motivo)) return "estrutural";
  }
  if (aceitas.includes(assinaturaRejeicao(base, r))) return "aceita";
  return "atencao";
}

export function resumirClasses(base: BaseId, rejeicoes: RejeicaoParaClassificar[], aceitas: readonly string[] = []): Record<ClasseRejeicao, RejeicaoParaClassificar[]> {
  const out: Record<ClasseRejeicao, RejeicaoParaClassificar[]> = { "em-branco": [], estrutural: [], "fora-de-escopo": [], aceita: [], atencao: [] };
  for (const r of rejeicoes) out[classificarRejeicao(base, r, aceitas)].push(r);
  return out;
}
