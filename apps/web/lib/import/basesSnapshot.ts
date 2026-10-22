/** Bases com sincronização autoritativa (aprovadas). Módulo sem dependências de Node: pode ser usado no navegador. */
export const BASES_SNAPSHOT = ["faturamento", "brindes", "cancelamentoSalao", "cancelamentoDelivery", "compraDireta", "retiradaDeposito"] as const;
export type BaseSnapshot = (typeof BASES_SNAPSHOT)[number];
export const baseSnapshot = (b: string): b is BaseSnapshot => (BASES_SNAPSHOT as readonly string[]).includes(b);

export interface ConfigSincronizacao {
  base: BaseSnapshot;
  tabela: string;
  /** Campos da chave além de unidade e data. O nome é o mesmo em `RegistroBase.extras` e na coluna do banco. */
  camposChave: readonly string[];
  /** "soma": linhas de mesma chave são somadas (já é assim nos parsers). "ultimo": a última linha vence (Retirada Depósito). */
  agregacao: "soma" | "ultimo";
  /**
   * Escopo de NEGÓCIO da fonte, como condição SQL constante sobre `x` (a tabela): só linhas do banco que satisfazem a condição podem ser
   * candidatas a exclusão. Ex.: a Retirada Depósito só importa motivo DEPÓSITO; SUPRIMENTO/ERRO existentes no banco estão FORA do escopo da fonte
   * e nunca são "só no banco". Constante do código (nunca vem do usuário).
   */
  filtroBancoSql?: string;
}

export const CONFIG_SINCRONIZACAO: Record<BaseSnapshot, ConfigSincronizacao> = {
  faturamento: { base: "faturamento", tabela: "faturamento", camposChave: [], agregacao: "soma" },
  brindes: { base: "brindes", tabela: "brindes", camposChave: ["motivo", "motivo2"], agregacao: "soma" },
  cancelamentoSalao: { base: "cancelamentoSalao", tabela: "cancelamento_salao", camposChave: ["motivo"], agregacao: "soma" },
  cancelamentoDelivery: { base: "cancelamentoDelivery", tabela: "cancelamento_delivery", camposChave: ["motivo"], agregacao: "soma" },
  compraDireta: { base: "compraDireta", tabela: "compra_direta", camposChave: ["motivo"], agregacao: "soma" },
  retiradaDeposito: { base: "retiradaDeposito", tabela: "retirada_deposito", camposChave: ["caixa", "motivo", "motivo_descricao", "usuario", "usuario_autorizador"], agregacao: "ultimo", filtroBancoSql: "upper(translate(x.motivo, 'ÓÔÕóôõ', 'OOOooo')) = 'DEPOSITO'" },
};
