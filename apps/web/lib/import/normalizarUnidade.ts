import { UNIDADES, type CodigoUnidade } from "@painel/shared";

/**
 * Normaliza um texto de unidade/filial vindo de uma planilha para o
 * código canônico (packages/shared/unidades.ts).
 *
 * Confirmado nos arquivos reais (Etapa 3):
 * - BRINDES.xlsx, CANCEL SALÃO.xlsx, CANCELAMENTOS DELIVERY.xlsx,
 *   COMPRA DIRETA.xlsx já usam os códigos canônicos ("BG 01".."MAPOLI"),
 *   só precisando trim de espaços (ex.: "MAPOLI ", "ROBS ").
 * - RETIRADA DEPOSITO NOVO.xlsx usa uma nomenclatura totalmente
 *   diferente: "BIGGS 02 - SANTOS DUMONT" em vez de "BG 02". O mapeamento
 *   abaixo cobre os 11 nomes observados nesse arquivo.
 *
 * PENDÊNCIA (ver docs/regras-negocio.md): esta tabela de "BIGGS ..." NÃO
 * foi confirmada como exaustiva para as 17 unidades — não apareceram
 * "BIGGS 08/09", "IS 01/02/03" nem "ROBS" em nenhum arquivo inspecionado
 * com essa nomenclatura. Não adivinhei esses mapeamentos.
 *
 * - "CASARIA" → MAPOLI: confirmado pelo usuário (investigação em 8 dos
 *   38 arquivos reais do projeto, incluindo a string literal
 *   "MAPOLI 01 - CASARIA" em 02_EXTRATOS_BANCARIOS.xlsx — ver
 *   docs/regras-negocio.md, seção "Investigação: CASARIA → MAPOLI").
 */
const MAPA_NOMES_ALTERNATIVOS: Record<string, CodigoUnidade> = {
  "BIGGS 01 - MARINGA": "BG 01",
  "BIGGS 02 - SANTOS DUMONT": "BG 02",
  "BIGGS 03 - GOIAS": "BG 03",
  "BIGGS 04 - WINSTON": "BG 04",
  "BIGGS 05 - PORTUGAL": "BG 05",
  "BIGGS 06 - HIGIENOPOLIS": "BG 06",
  "BIGGS 07 - JAMIL E ACAI": "BG 07",
  "BIGGS 10 - MARITACAS 88": "BG 10",
  "BIGGS 11 - SANTO AMARO": "BG 11",
  "BIGGS 12 - SAUL ELKIND": "BG 12",
  "BIGGS 13 - ARTHUR THOMAS": "BG 13",
  CASARIA: "MAPOLI",
};

const CODIGOS_CANONICOS = new Set<string>(UNIDADES);

export type ResultadoNormalizacao =
  | { ok: true; codigo: CodigoUnidade }
  | { ok: false; valorOriginal: string };

export function normalizarUnidade(valorBruto: string | null | undefined): ResultadoNormalizacao {
  const valor = (valorBruto ?? "").trim();

  if (CODIGOS_CANONICOS.has(valor)) {
    return { ok: true, codigo: valor as CodigoUnidade };
  }

  const alternativo = MAPA_NOMES_ALTERNATIVOS[valor.toUpperCase()];
  if (alternativo) {
    return { ok: true, codigo: alternativo };
  }

  return { ok: false, valorOriginal: valorBruto ?? "" };
}
