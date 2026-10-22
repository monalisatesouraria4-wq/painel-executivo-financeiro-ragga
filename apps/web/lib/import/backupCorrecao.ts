import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RegistroBanco } from "./correcaoChave";

/**
 * Backup completo (todos os campos) dos registros que serão removidos, gravado ANTES da transação. Nunca sobrescreve um
 * arquivo existente (flag "wx") e só retorna depois de reler o arquivo e conferir que ele contém exatamente os mesmos IDs.
 */
export function gravarBackupSeguro(diretorio: string, plano: unknown, registros: RegistroBanco[], agora: Date = new Date()): string {
  if (!diretorio) throw new Error("diretório de backup não informado");
  const dir = resolve(diretorio);
  mkdirSync(dir, { recursive: true });
  const arquivo = join(dir, `backup-correcao-compra-direta-${agora.toISOString().replace(/[:.]/g, "-")}.json`);
  if (existsSync(arquivo)) throw new Error(`o backup ${arquivo} já existe — não será sobrescrito`);
  const conteudo = JSON.stringify({ quando: agora.toISOString(), tabela: "compra_direta", plano, registros: registros.map((r) => r.completo) }, null, 1);
  writeFileSync(arquivo, conteudo, { flag: "wx" });
  const lido = JSON.parse(readFileSync(arquivo, "utf-8")) as { registros?: Array<{ id?: string }> };
  const idsLidos = (lido.registros ?? []).map((r) => String(r.id)).sort();
  const idsEsperados = registros.map((r) => r.id).sort();
  if (idsLidos.length !== idsEsperados.length || idsLidos.some((id, i) => id !== idsEsperados[i])) throw new Error("o backup gravado não confere com os registros lidos do banco");
  return arquivo;
}

/**
 * Backup completo de uma sincronização autoritativa (linhas removidas e valores anteriores das alteradas). Nunca
 * sobrescreve (flag "wx"), recusa diretório vazio e só devolve o caminho depois de reler o arquivo e conferir as contagens.
 */
export function gravarBackupSincronizacao(
  diretorio: string,
  conteudo: { base: string; tabela: string; hashPlano: string; removidos: Array<Record<string, unknown>>; alterados: Array<{ antes: Record<string, unknown>; depoisCentavos: number }>; novos?: unknown[]; escopo?: unknown },
  agora: Date = new Date()
): string {
  if (!diretorio) throw new Error("diretório de backup não informado");
  const dir = resolve(diretorio);
  mkdirSync(dir, { recursive: true });
  const arquivo = join(dir, `backup-sincronizacao-${conteudo.base}-${agora.toISOString().replace(/[:.]/g, "-")}.json`);
  if (existsSync(arquivo)) throw new Error(`o backup ${arquivo} já existe — não será sobrescrito`);
  writeFileSync(arquivo, JSON.stringify({ quando: agora.toISOString(), ...conteudo }, null, 1), { flag: "wx" });
  const lido = JSON.parse(readFileSync(arquivo, "utf-8")) as { removidos?: unknown[]; alterados?: unknown[]; hashPlano?: string };
  if ((lido.removidos ?? []).length !== conteudo.removidos.length || (lido.alterados ?? []).length !== conteudo.alterados.length || ((lido as { novos?: unknown[] }).novos ?? []).length !== (conteudo.novos ?? []).length || lido.hashPlano !== conteudo.hashPlano) {
    throw new Error("o backup gravado não confere com o conteúdo esperado");
  }
  return arquivo;
}
