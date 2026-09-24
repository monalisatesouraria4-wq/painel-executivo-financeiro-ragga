/**
 * Lista oficial das 17 unidades (planejamento aprovado — docs/regras-negocio.md).
 * Única fonte de verdade para o código de unidade em todo o sistema.
 */
export const UNIDADES = [
  "BG 01",
  "BG 02",
  "BG 03",
  "BG 04",
  "BG 05",
  "BG 06",
  "BG 07",
  "BG 08 E 09",
  "BG 10",
  "BG 11",
  "BG 12",
  "BG 13",
  "IS 01",
  "IS 02",
  "IS 03",
  "ROBS",
  "MAPOLI",
] as const;

export type CodigoUnidade = (typeof UNIDADES)[number];
