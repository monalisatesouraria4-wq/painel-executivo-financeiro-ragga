import { UNIDADES, type CodigoUnidade } from "@painel/shared";

/**
 * Normaliza um texto de unidade/filial vindo de uma planilha para o
 * código canônico (packages/shared/unidades.ts).
 *
 * A partir da Etapa 4, esta função espelha fielmente `normalizeFilialJS`
 * do painel HTML atual (fonte de verdade já confirmada — ver
 * docs/regras-negocio.md, seção "Regras Confirmadas a partir do Painel
 * Atual"), em vez de uma lista fixa de nomes. Isso foi necessário porque
 * `FECHAMENTO DE CAIXA - ABERTOS_FECHADOS_CONCILIADOS.xlsx.xlsx` usa
 * "ISAIAS 01 - MARINGA" (padrão "ISAIAS NN"), que não estava coberto
 * pela tabela fixa anterior — mas o painel atual já reconhece esse
 * padrão, então aplicá-lo aqui não é uma regra nova, é usar uma regra já
 * confirmada que ainda não tinha sido replicada no código.
 *
 * Confirmado nos arquivos reais:
 * - BRINDES.xlsx, CANCEL SALÃO.xlsx, CANCELAMENTOS DELIVERY.xlsx,
 *   COMPRA DIRETA.xlsx já usam os códigos canônicos ("BG 01".."MAPOLI").
 * - RETIRADA DEPOSITO NOVO.xlsx e FECHAMENTO DE CAIXA usam nomenclatura
 *   "BIGGS NN - Nome" / "ISAIAS NN - Nome".
 * - "CASARIA" → MAPOLI: confirmado pelo usuário (ver docs/regras-negocio.md,
 *   seção "Investigação: CASARIA → MAPOLI").
 * - "R" → ROBS e "C" → MAPOLI: confirmado pelo usuário (visto na base de
 *   Conferência, abas a partir de "16.09 a 15.10" — abreviação de
 *   "ROBS"/"MAPOLI ou CASARIA" nas mesmas posições onde o período
 *   original tinha os nomes por extenso). ATENÇÃO: "R" e "C" são letras
 *   isoladas — mapeamento válido apenas quando a célula é EXATAMENTE
 *   "R" ou "C" (sem mais nada); ainda assim, é um alias mais genérico
 *   que os outros e pode colidir se outra fonte usar "R"/"C" com outro
 *   significado como valor de filial — não visto até agora.
 */

function removerAcentos(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const CODIGOS_CANONICOS = new Set<string>(UNIDADES);

export type ResultadoNormalizacao =
  | { ok: true; codigo: CodigoUnidade }
  | { ok: false; valorOriginal: string };

export function normalizarUnidade(valorBruto: string | null | undefined): ResultadoNormalizacao {
  const original = valorBruto ?? "";
  if (original.trim() === "") {
    return { ok: false, valorOriginal: original };
  }

  const s = removerAcentos(original.trim().toUpperCase()).replace(/\s+/g, " ");

  if (s === "CASARIA") return { ok: true, codigo: "MAPOLI" };
  if (s === "R") return { ok: true, codigo: "ROBS" };
  if (s === "C") return { ok: true, codigo: "MAPOLI" };
  if (s === "ROBS" || s === "MAPOLI") {
    return CODIGOS_CANONICOS.has(s) ? { ok: true, codigo: s as CodigoUnidade } : { ok: false, valorOriginal: original };
  }

  if (/^BG\s*0?8\s*E\s*0?9$/.test(s) || s === "BG 09" || s === "BG 08") {
    return { ok: true, codigo: "BG 08 E 09" };
  }
  if (/^BIGGS\s+0?8\s*E\s*0?9\b/.test(s)) {
    return { ok: true, codigo: "BG 08 E 09" };
  }

  let m = s.match(/^BG\s*0?(\d{1,2})$/);
  if (m) {
    const num = parseInt(m[1], 10);
    if (num === 8 || num === 9) return { ok: true, codigo: "BG 08 E 09" };
    const codigo = `BG ${String(num).padStart(2, "0")}`;
    return CODIGOS_CANONICOS.has(codigo) ? { ok: true, codigo: codigo as CodigoUnidade } : { ok: false, valorOriginal: original };
  }

  m = s.match(/^IS\s*0?(\d{1,2})$/);
  if (m) {
    const codigo = `IS ${String(parseInt(m[1], 10)).padStart(2, "0")}`;
    return CODIGOS_CANONICOS.has(codigo) ? { ok: true, codigo: codigo as CodigoUnidade } : { ok: false, valorOriginal: original };
  }

  m = s.match(/^BIGGS\s*0?(\d{1,2})\b/);
  if (m) {
    const num = parseInt(m[1], 10);
    if (num === 8 || num === 9) return { ok: true, codigo: "BG 08 E 09" };
    const codigo = `BG ${String(num).padStart(2, "0")}`;
    return CODIGOS_CANONICOS.has(codigo) ? { ok: true, codigo: codigo as CodigoUnidade } : { ok: false, valorOriginal: original };
  }

  m = s.match(/^ISAIAS\s*0?(\d{1,2})\b/);
  if (m) {
    const codigo = `IS ${String(parseInt(m[1], 10)).padStart(2, "0")}`;
    return CODIGOS_CANONICOS.has(codigo) ? { ok: true, codigo: codigo as CodigoUnidade } : { ok: false, valorOriginal: original };
  }

  return { ok: false, valorOriginal: original };
}
