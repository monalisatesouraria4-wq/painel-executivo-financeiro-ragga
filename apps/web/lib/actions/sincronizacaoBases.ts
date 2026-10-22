"use server";

import { resolve } from "node:path";
import { getSql } from "@/lib/db/client";
import { gravarBackupSincronizacao } from "@/lib/import/backupCorrecao";
import { planejarNoBanco, sincronizarBase } from "@/lib/import/bancoSincronizacaoPg";
import { MOTIVO_EXCLUSOES_DESABILITADAS, exclusoesHabilitadas } from "@/lib/import/exclusoesHabilitadas";
import { expandirLote, type LoteCompacto } from "@/lib/import/loteCompacto";
import type { PlanoSincronizacao } from "@/lib/import/sincronizacaoBase";
import type { RegistroBase } from "@/lib/import/tipos";

/**
 * Server Actions da tela de importação para as bases com sincronização autoritativa (Faturamento, Brindes, Cancelamentos,
 * Compra Direta e Retirada Depósito). A interface NÃO decide nada: toda regra (escopo, riscos, bloqueios, hash, backup,
 * transação serializável, validação final e rollback) está em `lib/import/sincronizacaoBase.ts` / `bancoSincronizacaoPg.ts`
 * e é recalculada AQUI, no servidor, a partir dos registros recebidos — nunca a partir de um plano enviado pelo cliente.
 *
 * Duas ações apenas: `previsualizarSincronizacaoBase` (somente leitura) e `confirmarSincronizacaoBase` (grava).
 * Exclusões só acontecem com: plano sem riscos que bloqueiem, hash aprovado igual ao plano recalculado, confirmação digitada
 * ("EXCLUIR n"), backup gravado antes e exclusões habilitadas EXPLICITAMENTE (SINCRONIZACAO_EXCLUSOES_HABILITADAS=1, opt-in em todos os ambientes).
 */

export interface OpcoesUsuarioSincronizacao {
  /** Grava só novos/alterados e preserva os registros só no banco. */
  semExclusao?: boolean;
  /** Confirma que dias sem nenhuma linha na fonte (lojas presentes) devem ter o que existe no banco removido. */
  confirmarDiasSemMovimento?: boolean;
}

export interface EntradaSincronizacao {
  base: string;
  /** Lote em formato COMPACTO (ver `lib/import/loteCompacto.ts`): tuplas [unidade, data, centavos, ...chave]. */
  registros: LoteCompacto;
  opcoes?: OpcoesUsuarioSincronizacao;
  /** SHA-256 do arquivo (entra no hash do plano). */
  arquivoSha256?: string;
}

const LIMITE_LISTA_REMOVIVEIS = 3000;

/** Diretório de backup das sincronizações: SINCRONIZACAO_BACKUP_DIR, ou (fora de produção) `apps/web/backups-sincronizacao`. */
function diretorioBackup(): string | null {
  if (process.env.SINCRONIZACAO_BACKUP_DIR) return resolve(process.env.SINCRONIZACAO_BACKUP_DIR);
  if (process.env.NODE_ENV !== "production") return resolve(process.cwd(), "backups-sincronizacao");
  return null;
}

function validarEntrada(entrada: EntradaSincronizacao): { base: ReturnType<typeof expandirLote>["base"]; registros: RegistroBase[] } {
  return expandirLote(entrada?.base, entrada?.registros);
}

function opcoesPlano(entrada: EntradaSincronizacao) {
  const o = entrada.opcoes ?? {};
  return { semExclusao: Boolean(o.semExclusao), confirmarDiasSemMovimento: Boolean(o.confirmarDiasSemMovimento), arquivoSha256: typeof entrada.arquivoSha256 === "string" ? entrada.arquivoSha256.slice(0, 64) : undefined };
}

export type PlanoParaTela = Omit<PlanoSincronizacao, "removiveis" | "novos" | "alterados"> & {
  removiveis: PlanoSincronizacao["removiveis"];
  removiveisTotal: number;
  removiveisTruncados: boolean;
  novosTotal: number;
  alteradosTotal: number;
};

export type ResultadoPrevia =
  | { conectado: false }
  | { conectado: true; plano: PlanoParaTela; exclusoesHabilitadas: boolean; backupDisponivel: boolean };

/** SOMENTE LEITURA: calcula o plano de sincronização e o devolve para a tela revisar. */
export async function previsualizarSincronizacaoBase(entrada: EntradaSincronizacao): Promise<ResultadoPrevia> {
  if (!process.env.DATABASE_URL) return { conectado: false };
  const { base, registros } = validarEntrada(entrada);
  const plano = await planejarNoBanco(getSql(), base, registros, opcoesPlano(entrada));
  const { novos, alterados, removiveis, ...resto } = plano;
  return {
    conectado: true,
    exclusoesHabilitadas: exclusoesHabilitadas(),
    backupDisponivel: diretorioBackup() !== null,
    plano: {
      ...resto,
      removiveis: removiveis.slice(0, LIMITE_LISTA_REMOVIVEIS),
      removiveisTotal: removiveis.length,
      removiveisTruncados: removiveis.length > LIMITE_LISTA_REMOVIVEIS,
      novosTotal: novos.length,
      alteradosTotal: alterados.length,
    },
  };
}

export type ResultadoConfirmacao =
  | { status: "gravado"; inseridos: number; atualizados: number; removidos: number; backup: string | null; totalNoEscopoDepois: { chaves: number; centavos: number } }
  | { status: "bloqueado" | "revertido"; motivo: string };

/** GRAVA: recalcula o plano no servidor e só prossegue se o hash aprovado pela tela for idêntico. */
export async function confirmarSincronizacaoBase(entrada: EntradaSincronizacao & { hashPlanoAprovado?: string; confirmacaoExclusao?: string }): Promise<ResultadoConfirmacao> {
  if (!process.env.DATABASE_URL) return { status: "bloqueado", motivo: "Banco não configurado neste ambiente." };
  const { base, registros } = validarEntrada(entrada);
  const sql = getSql();
  const opcoes = opcoesPlano(entrada);
  const plano = await planejarNoBanco(sql, base, registros, opcoes);
  const exclusoes = plano.idsParaRemover.length;
  if (exclusoes > 0) {
    if (!exclusoesHabilitadas()) return { status: "bloqueado", motivo: MOTIVO_EXCLUSOES_DESABILITADAS };
    if (entrada.confirmacaoExclusao !== `EXCLUIR ${exclusoes}`) return { status: "bloqueado", motivo: `Confirmação de exclusão ausente ou incorreta: digite exatamente "EXCLUIR ${exclusoes}".` };
  }
  const dir = diretorioBackup();
  const r = await sincronizarBase(sql, base, registros, {
    ...opcoes,
    confirmar: true,
    hashPlanoAprovado: entrada.hashPlanoAprovado,
    exigirBackupParaAlteracoes: false,
    gravarBackup: dir ? async (c) => gravarBackupSincronizacao(dir, c) : undefined,
  });
  if (r.status === "gravado") return { status: "gravado", inseridos: r.inseridos, atualizados: r.atualizados, removidos: r.removidos, backup: r.backup, totalNoEscopoDepois: r.totalNoEscopoDepois };
  if (r.status === "bloqueado") return { status: "bloqueado", motivo: r.motivo };
  if (r.status === "revertido") return { status: "revertido", motivo: r.erro };
  return { status: "bloqueado", motivo: "Resultado inesperado." };
}
