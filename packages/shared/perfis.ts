/**
 * Perfis de acesso previstos no planejamento (docs/regras-negocio.md, item 4).
 * Nesta etapa, todo usuário criado recebe FINANCEIRO_MASTER — os demais
 * perfis existem no schema para uso futuro, sem tela de administração ainda.
 */
export const PERFIS = [
  "admin",
  "financeiro_master",
  "financeiro",
  "gestor_regional",
  "gestor_loja",
] as const;

export type Perfil = (typeof PERFIS)[number];
