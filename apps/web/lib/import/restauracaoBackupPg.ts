import type postgres from "postgres";
import { lerBancoNoIntervalo } from "./bancoSincronizacaoPg";
import { MOTIVO_EXCLUSOES_DESABILITADAS, exclusoesHabilitadas } from "./exclusoesHabilitadas";
import { CONFIG_SINCRONIZACAO, baseSnapshot, chaveLinha, type BaseSnapshot, type LinhaFonte } from "./sincronizacaoBase";

/**
 * RESTAURAÇÃO a partir do backup que a sincronização grava ANTES de excluir/alterar. É o que torna a exclusão RECUPERÁVEL:
 *  - reinsere, com o mesmo id e todos os campos, os registros que foram excluídos;
 *  - devolve ao valor anterior os registros cujo valor a sincronização alterou (só se ainda valem o que a sincronização gravou);
 *  - com `removerNovos`, remove os registros que a sincronização inseriu (só se ainda valem o que ela gravou) — isso é uma EXCLUSÃO
 *    e por isso exige SINCRONIZACAO_EXCLUSOES_HABILITADAS=1.
 * Simulação por padrão (só leitura). Gravação: transação serializável, conflitos bloqueiam, validação final linha a linha.
 */

export interface BackupSincronizacao {
  base: BaseSnapshot;
  tabela: string;
  hashPlano: string;
  escopo: { unidades: string[]; inicio: string; fim: string };
  removidos: Array<Record<string, unknown>>;
  alterados: Array<{ antes: Record<string, unknown>; depoisCentavos: number }>;
  novos: LinhaFonte[];
}

export function lerBackup(conteudo: unknown): BackupSincronizacao {
  const b = conteudo as Partial<BackupSincronizacao> | null;
  if (!b || typeof b !== "object") throw new Error("Backup ilegível.");
  if (typeof b.base !== "string" || !baseSnapshot(b.base)) throw new Error("Backup de uma base sem sincronização autoritativa.");
  if (b.tabela !== CONFIG_SINCRONIZACAO[b.base].tabela) throw new Error("A tabela do backup não corresponde à base.");
  if (!b.escopo || !Array.isArray(b.escopo.unidades) || typeof b.escopo.inicio !== "string" || typeof b.escopo.fim !== "string") throw new Error("Backup sem escopo.");
  if (!Array.isArray(b.removidos) || !Array.isArray(b.alterados)) throw new Error("Backup incompleto (removidos/alterados).");
  const id = (r: Record<string, unknown>) => typeof r?.id === "string" && /^[0-9a-f-]{36}$/i.test(r.id);
  if (!b.removidos.every(id) || !b.alterados.every((a) => id(a.antes) && Number.isSafeInteger(a.depoisCentavos))) throw new Error("Backup com registros sem id válido.");
  return { ...(b as BackupSincronizacao), novos: Array.isArray(b.novos) ? b.novos : [] };
}

export interface PlanoRestauracao {
  base: BaseSnapshot;
  reinserir: number;
  reverterValores: number;
  removerNovos: number;
  /** Itens que impedem a restauração (o banco mudou desde a sincronização). */
  conflitos: string[];
  /** true se a remoção dos registros inseridos pela sincronização foi pedida. */
  removerNovosPedido: boolean;
}

export type ResultadoRestauracao =
  | { status: "simulacao"; plano: PlanoRestauracao }
  | { status: "bloqueado"; plano: PlanoRestauracao; motivo: string }
  | { status: "revertido"; plano: PlanoRestauracao; erro: string }
  | { status: "restaurado"; plano: PlanoRestauracao };

type Q = postgres.Sql | postgres.TransactionSql;
const raw = (q: Q) => q as unknown as postgres.Sql;

async function avaliar(q: Q, b: BackupSincronizacao, removerNovos: boolean, travar: boolean): Promise<{ plano: PlanoRestauracao; idsNovosParaRemover: string[] }> {
  const cfg = CONFIG_SINCRONIZACAO[b.base];
  const atuais = await lerBancoNoIntervalo(q, b.base, b.escopo.inicio, b.escopo.fim, travar);
  const porId = new Map(atuais.map((l) => [l.id, l]));
  const porChave = new Map(atuais.map((l) => [chaveLinha(l), l]));
  const conflitos: string[] = [];

  for (const r of b.removidos) {
    if (porId.has(String(r.id))) conflitos.push(`o id ${r.id} já existe no banco (não será reinserido por cima)`);
  }
  // chave dos removidos = unidade (código) + data + campos de chave; o `completo` tem unidade_id, então comparamos pelo id e por (unidade_id, data, chave)
  const chaveDoCompleto = (r: Record<string, unknown>) => [String(r.unidade_id), String(r.data).slice(0, 10), ...cfg.camposChave.map((c) => String(r[c] ?? ""))].join("|");
  const chavesAtuaisPorUnidadeId = new Map<string, string>();
  const idsUnidade = await raw(q).unsafe(`select id::text as id, x.data::text as d, ${cfg.camposChave.map((c) => `coalesce(x.${c}, '') as k_${c}`).join(", ") || "1 as k_"}, x.unidade_id::text as uid from ${cfg.tabela} x where x.data between $1::date and $2::date`, [b.escopo.inicio, b.escopo.fim]);
  for (const r of idsUnidade) chavesAtuaisPorUnidadeId.set([r.uid, r.d, ...cfg.camposChave.map((c) => String(r[`k_${c}`] ?? ""))].join("|"), r.id as string);
  for (const r of b.removidos) {
    const existente = chavesAtuaisPorUnidadeId.get(chaveDoCompleto(r));
    if (existente && existente !== String(r.id)) conflitos.push(`já existe outro registro (id ${existente}) com a mesma chave do removido ${r.id}`);
  }
  for (const a of b.alterados) {
    const atual = porId.get(String(a.antes.id));
    if (!atual) conflitos.push(`o registro alterado ${a.antes.id} não existe mais no banco`);
    else if (atual.centavos !== a.depoisCentavos) conflitos.push(`o registro alterado ${a.antes.id} vale hoje ${atual.centavos / 100}, diferente do que a sincronização gravou (${a.depoisCentavos / 100}) — mudou depois`);
  }
  const idsNovosParaRemover: string[] = [];
  if (removerNovos) {
    for (const n of b.novos) {
      const atual = porChave.get(chaveLinha(n));
      if (!atual) continue; // já não existe: nada a remover
      if (atual.centavos !== n.centavos) conflitos.push(`o registro inserido ${n.unidade} ${n.data} ${n.chave.join(" | ")} vale hoje ${atual.centavos / 100}, diferente do que a sincronização gravou (${n.centavos / 100})`);
      else idsNovosParaRemover.push(atual.id);
    }
  }
  return {
    plano: { base: b.base, reinserir: b.removidos.length, reverterValores: b.alterados.length, removerNovos: idsNovosParaRemover.length, conflitos, removerNovosPedido: removerNovos },
    idsNovosParaRemover,
  };
}

export async function restaurarBackup(sql: postgres.Sql, conteudo: unknown, opcoes: { confirmar: boolean; removerNovos?: boolean }): Promise<ResultadoRestauracao> {
  const b = lerBackup(conteudo);
  const cfg = CONFIG_SINCRONIZACAO[b.base];
  const { plano } = await avaliar(sql, b, Boolean(opcoes.removerNovos), false);
  if (!opcoes.confirmar) return { status: "simulacao", plano };
  if (plano.conflitos.length > 0) return { status: "bloqueado", plano, motivo: `${plano.conflitos.length} conflito(s): o banco mudou desde a sincronização — nada foi restaurado` };
  if (opcoes.removerNovos && plano.removerNovos > 0 && !exclusoesHabilitadas()) return { status: "bloqueado", plano, motivo: MOTIVO_EXCLUSOES_DESABILITADAS };

  try {
    await sql.begin("isolation level serializable", async (tx) => {
      const dentro = await avaliar(tx, b, Boolean(opcoes.removerNovos), true);
      if (dentro.plano.conflitos.length > 0) throw new Error(`conflitos dentro da transação: ${dentro.plano.conflitos.join(" | ")}`);
      if (b.removidos.length > 0) {
        await raw(tx).unsafe(`insert into ${cfg.tabela} select * from jsonb_populate_recordset(null::${cfg.tabela}, $1::jsonb)`, [b.removidos as never]);
      }
      for (const a of b.alterados) {
        const r = await raw(tx).unsafe(`update ${cfg.tabela} set valor = ($2::text)::numeric, atualizado_em = ($3::text)::timestamptz where id = $1::uuid and round(valor * 100)::bigint = $4::bigint returning id`, [String(a.antes.id), String(a.antes.valor), String(a.antes.atualizado_em), a.depoisCentavos]);
        if (r.length !== 1) throw new Error(`não foi possível devolver o valor anterior do registro ${a.antes.id}`);
      }
      if (dentro.idsNovosParaRemover.length > 0) {
        const r = await raw(tx).unsafe(`delete from ${cfg.tabela} where id = any($1::uuid[]) returning id`, [dentro.idsNovosParaRemover]);
        if (r.length !== dentro.idsNovosParaRemover.length) throw new Error("a remoção dos registros inseridos afetou um nº inesperado de linhas");
      }
      // validação final: cada registro restaurado é IDÊNTICO ao do backup (todos os campos)
      if (b.removidos.length > 0) {
        const [ok] = await raw(tx).unsafe(`select count(*)::int n from ${cfg.tabela} x join jsonb_array_elements($1::jsonb) j on (j->>'id')::uuid = x.id where to_jsonb(x) = j`, [b.removidos as never]);
        if (Number(ok.n) !== b.removidos.length) throw new Error(`restauração divergente: ${ok.n} de ${b.removidos.length} registros idênticos ao backup`);
      }
      for (const a of b.alterados) {
        const [r] = await raw(tx).unsafe(`select (to_jsonb(x) - 'atualizado_em') = ($2::jsonb - 'atualizado_em') as igual from ${cfg.tabela} x where id = $1::uuid`, [String(a.antes.id), a.antes as never]);
        if (!r?.igual) throw new Error(`o registro ${a.antes.id} não ficou idêntico ao do backup`);
      }
    });
    return { status: "restaurado", plano };
  } catch (e) {
    return { status: "revertido", plano, erro: e instanceof Error ? e.message : String(e) };
  }
}
