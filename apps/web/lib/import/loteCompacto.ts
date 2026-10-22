import { UNIDADES } from "@painel/shared";
import { CONFIG_SINCRONIZACAO, baseSnapshot, type BaseSnapshot } from "./basesSnapshot";
import type { RegistroBase } from "./tipos";

/**
 * Formato COMPACTO do lote enviado pela tela às Server Actions da sincronização. As Server Actions têm limite de corpo (1 MB por
 * padrão; aqui 4 MB, ver `next.config.ts`) e o lote completo de Brindes (6.589 registros) já passava de 1 MB no formato anterior
 * (objetos com chaves repetidas, `linhaOrigem`, `extras` e Date). Cada registro vira uma TUPLA:
 *
 *   [unidade, "AAAA-MM-DD", centavos (inteiro), ...valores dos campos de chave da base]
 *
 * Sem perda: centavos é o mesmo `Math.round(valor * 100)` usado pelo planejamento (hash do plano idêntico ao do comando).
 * Módulo sem dependências de Node (usado no navegador e no servidor). A expansão VALIDA tudo (nunca confia no cliente).
 */
export type RegistroCompacto = [string, string, number, ...string[]];
export type LoteCompacto = RegistroCompacto[];

export const LIMITE_REGISTROS_LOTE = 100_000;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function compactarLote(base: BaseSnapshot, registros: RegistroBase[]): LoteCompacto {
  const campos = CONFIG_SINCRONIZACAO[base].camposChave;
  return registros.map((r) => [r.unidade, r.data.toISOString().slice(0, 10), Math.round(r.valor * 100), ...campos.map((c) => r.extras[c] ?? "")]);
}

/** Expande e VALIDA o lote recebido (servidor). Lança `Error` com mensagem em português se algo estiver fora do padrão. */
export function expandirLote(baseEntrada: unknown, lote: unknown): { base: BaseSnapshot; registros: RegistroBase[] } {
  if (typeof baseEntrada !== "string" || !baseSnapshot(baseEntrada)) throw new Error("Base sem sincronização autoritativa.");
  const base = baseEntrada;
  if (!Array.isArray(lote) || lote.length === 0 || lote.length > LIMITE_REGISTROS_LOTE) throw new Error(`Lote inválido: informe entre 1 e ${LIMITE_REGISTROS_LOTE.toLocaleString("pt-BR")} registros.`);
  const campos = CONFIG_SINCRONIZACAO[base].camposChave;
  const registros: RegistroBase[] = [];
  for (const t of lote as unknown[]) {
    const ok =
      Array.isArray(t) &&
      t.length === 3 + campos.length &&
      typeof t[0] === "string" &&
      (UNIDADES as readonly string[]).includes(t[0]) &&
      typeof t[1] === "string" &&
      DATA_ISO.test(t[1]) &&
      Number.isSafeInteger(t[2]) &&
      t.slice(3).every((v) => typeof v === "string");
    if (!ok) throw new Error("O lote contém registro inválido (unidade, data, valor ou campos de chave).");
    const tupla = t as RegistroCompacto;
    const data = new Date(`${tupla[1]}T00:00:00.000Z`);
    if (!Number.isFinite(data.getTime()) || data.toISOString().slice(0, 10) !== tupla[1]) throw new Error("O lote contém registro inválido (data inexistente).");
    const extras: Record<string, string> = {};
    campos.forEach((c, i) => { extras[c] = tupla[3 + i] as string; });
    registros.push({ unidade: tupla[0] as RegistroBase["unidade"], data, valor: tupla[2] / 100, extras, linhaOrigem: 0 });
  }
  return { base, registros };
}
