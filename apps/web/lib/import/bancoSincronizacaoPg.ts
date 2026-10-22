import type postgres from "postgres";
import {
  CONFIG_SINCRONIZACAO,
  chaveLinha,
  escopoDaFonte,
  hashSnapshotBanco,
  planejarSincronizacaoBase,
  type BaseSnapshot,
  type LinhaBanco,
  type LinhaFonte,
  type OpcoesPlano,
  type PlanoSincronizacao,
} from "./sincronizacaoBase";
import type { RegistroBase } from "./tipos";
import { MOTIVO_EXCLUSOES_DESABILITADAS, exclusoesHabilitadas } from "./exclusoesHabilitadas";

/**
 * Camada SQL REAL da sincronização autoritativa (postgres.js). Usada pelo comando `atualizar-bases` e pelo teste de
 * integração (PostgreSQL local descartável). Leitura da prévia = somente SELECT. Gravação = UMA transação serializável com
 * as linhas do escopo travadas, revalidação do plano dentro da transação, exclusão por IDs exatos, upsert, validação final
 * linha a linha e comparação do que está FORA do escopo (que não pode mudar); qualquer divergência reverte tudo.
 */

type Q = postgres.Sql | postgres.TransactionSql;
const sqlRaw = (q: Q) => q as postgres.Sql;

const centavosDe = (valor: number) => Math.round(valor * 100);
const textoValor = (centavos: number) => (centavos / 100).toFixed(2);

/** Converte o lote já parseado (RegistroBase) em linhas da fonte para o planejamento. */
export function linhasFonteDeRegistros(base: BaseSnapshot, registros: RegistroBase[]): LinhaFonte[] {
  const campos = CONFIG_SINCRONIZACAO[base].camposChave;
  return registros.map((r) => ({
    unidade: r.unidade,
    data: r.data.toISOString().slice(0, 10),
    chave: campos.map((c) => r.extras[c] ?? ""),
    centavos: centavosDe(r.valor),
  }));
}

interface LinhaBancoCompleta extends LinhaBanco {
  completo: Record<string, unknown>;
}

/** Lê o banco entre `inicio` e `fim` para TODAS as lojas (permite detectar loja ausente do arquivo). */
export async function lerBancoNoIntervalo(q: Q, base: BaseSnapshot, inicio: string, fim: string, travar = false): Promise<LinhaBancoCompleta[]> {
  const cfg = CONFIG_SINCRONIZACAO[base];
  const colunasChave = cfg.camposChave.map((c) => `, coalesce(x.${c}, '') as k_${c}`).join("");
  const rows = await sqlRaw(q).unsafe(
    `select x.id::text as id, u.codigo as unidade, x.data::text as data, round(x.valor * 100)::bigint::text as centavos, to_jsonb(x) as completo${colunasChave}
       from ${cfg.tabela} x join unidades u on u.id = x.unidade_id
      where x.data between $1::date and $2::date${cfg.filtroBancoSql ? ` and (${cfg.filtroBancoSql})` : ""}
      order by x.id${travar ? " for update of x" : ""}`,
    [inicio, fim]
  );
  return rows.map((r) => ({
    id: r.id as string,
    unidade: r.unidade as string,
    data: r.data as string,
    chave: cfg.camposChave.map((c) => String(r[`k_${c}`] ?? "")),
    centavos: Number(r.centavos),
    completo: r.completo as Record<string, unknown>,
  }));
}

/** Contagem + hash do que está FORA do escopo (mesma tabela): não pode mudar com a sincronização. */
async function hashForaDoEscopo(q: Q, base: BaseSnapshot, escopo: { unidades: string[]; inicio: string; fim: string }): Promise<{ n: number; hash: string }> {
  const cfg = CONFIG_SINCRONIZACAO[base];
  const [r] = await sqlRaw(q).unsafe(
    `select count(*)::int as n, md5(coalesce(string_agg(j, ',' order by j), '')) as h
       from (select to_jsonb(x)::text as j from ${cfg.tabela} x join unidades u on u.id = x.unidade_id
              where not (u.codigo = any($1::text[]) and x.data between $2::date and $3::date${cfg.filtroBancoSql ? ` and (${cfg.filtroBancoSql})` : ""})) s`,
    [escopo.unidades, escopo.inicio, escopo.fim]
  );
  return { n: Number(r.n), hash: String(r.h) };
}

export interface ConteudoBackupSincronizacao {
  base: BaseSnapshot;
  tabela: string;
  hashPlano: string;
  escopo: PlanoSincronizacao["escopo"];
  /** linhas completas (todos os campos) que serão excluídas */
  removidos: Array<Record<string, unknown>>;
  /** linhas completas ANTES da alteração de valor */
  alterados: Array<{ antes: Record<string, unknown>; depoisCentavos: number }>;
  /** chaves (e valores) que a sincronização INSERE — permitem desfazer a inserção na restauração */
  novos: LinhaFonte[];
}

export interface OpcoesSincronizacaoPg extends OpcoesPlano {
  confirmar: boolean;
  /** Hash do plano aprovado na simulação. Obrigatório quando há exclusões. */
  hashPlanoAprovado?: string;
  /** Grava o backup (completo, sem sobrescrever) ANTES da transação e devolve o caminho. Obrigatório quando há exclusões/alterações. */
  gravarBackup?: (conteudo: ConteudoBackupSincronizacao) => Promise<string>;
  /**
   * Padrão true (comando). Com false (tela de importação sem diretório de backup), alterações de VALOR sem exclusão não exigem
   * backup — como no upsert tradicional; EXCLUSÕES exigem backup sempre. Se houver `gravarBackup`, o backup é feito de qualquer forma.
   */
  exigirBackupParaAlteracoes?: boolean;
}

export type ResultadoSincronizacaoPg =
  | { status: "simulacao"; plano: PlanoSincronizacao }
  | { status: "bloqueado"; plano: PlanoSincronizacao; motivo: string }
  | { status: "revertido"; plano: PlanoSincronizacao; erro: string }
  | {
      status: "gravado";
      plano: PlanoSincronizacao;
      inseridos: number;
      atualizados: number;
      removidos: number;
      backup: string | null;
      totalNoEscopoDepois: { chaves: number; centavos: number };
    };

export async function planejarNoBanco(sql: postgres.Sql, base: BaseSnapshot, registros: RegistroBase[], opcoes: OpcoesPlano = {}): Promise<PlanoSincronizacao> {
  const fonte = linhasFonteDeRegistros(base, registros);
  const escopo = escopoDaFonte(fonte);
  const banco = escopo ? await lerBancoNoIntervalo(sql, base, escopo.inicio, escopo.fim) : [];
  return planejarSincronizacaoBase({ base, fonte, banco, opcoes });
}

export async function sincronizarBase(sql: postgres.Sql, base: BaseSnapshot, registros: RegistroBase[], opcoes: OpcoesSincronizacaoPg): Promise<ResultadoSincronizacaoPg> {
  const cfg = CONFIG_SINCRONIZACAO[base];
  const fonte = linhasFonteDeRegistros(base, registros);
  const plano = await planejarNoBanco(sql, base, registros, opcoes);
  if (!opcoes.confirmar) return { status: "simulacao", plano };
  if (!plano.escopo) return { status: "bloqueado", plano, motivo: "fonte vazia" };
  if (!plano.podeGravar) {
    return { status: "bloqueado", plano, motivo: `riscos impedem a gravação: ${plano.riscos.filter((r) => r.gravidade !== "aviso").map((r) => r.codigo).join(", ")}` };
  }
  const temExclusao = plano.idsParaRemover.length > 0;
  // TRAVA DE SEGURANÇA (opt-in em todos os ambientes): nenhuma exclusão sem SINCRONIZACAO_EXCLUSOES_HABILITADAS=1 — vale para o comando, a tela e a Server Action
  if (temExclusao && !exclusoesHabilitadas()) return { status: "bloqueado", plano, motivo: MOTIVO_EXCLUSOES_DESABILITADAS };
  if (temExclusao && opcoes.hashPlanoAprovado !== plano.hashPlano) {
    return { status: "bloqueado", plano, motivo: "o hash do plano aprovado não confere com o plano atual (o banco ou a fonte mudaram desde a simulação)" };
  }
  const escopo = plano.escopo;
  const temAlteracao = plano.alterados.length > 0;
  const backupObrigatorio = temExclusao || (temAlteracao && opcoes.exigirBackupParaAlteracoes !== false);
  if (backupObrigatorio && !opcoes.gravarBackup) return { status: "bloqueado", plano, motivo: "backup não configurado — gravação recusada" };

  // backup ANTES de qualquer alteração (as linhas completas que serão removidas/alteradas)
  let backup: string | null = null;
  if ((temExclusao || temAlteracao) && opcoes.gravarBackup) {
    const completas = await lerBancoNoIntervalo(sql, base, escopo.inicio, escopo.fim);
    const porId = new Map(completas.map((l) => [l.id, l]));
    try {
      backup = await opcoes.gravarBackup({
        base, tabela: cfg.tabela, hashPlano: plano.hashPlano, escopo: plano.escopo,
        removidos: plano.idsParaRemover.map((id) => porId.get(id)!.completo),
        alterados: plano.alterados.map((a) => ({ antes: porId.get(a.id)!.completo, depoisCentavos: a.depois.centavos })),
        novos: plano.novos,
      });
    } catch (e) {
      return { status: "bloqueado", plano, motivo: `falha ao gravar o backup (${e instanceof Error ? e.message : String(e)}) — nada foi alterado` };
    }
  }

  try {
    const resultado = await sql.begin("isolation level serializable", async (tx) => {
      // 1) relê e TRAVA o escopo; o plano recalculado tem de ser idêntico ao aprovado
      const dentro = await lerBancoNoIntervalo(tx, base, escopo.inicio, escopo.fim, true);
      const planoDentro = planejarSincronizacaoBase({ base, fonte, banco: dentro, opcoes });
      if (planoDentro.hashPlano !== plano.hashPlano) throw new Error("o banco mudou entre a simulação e a gravação (hash do plano diferente) — transação revertida");
      const foraAntes = await hashForaDoEscopo(tx, base, escopo);

      // 2) exclusão por IDs exatos
      if (plano.idsParaRemover.length > 0) {
        const removidos = await sqlRaw(tx).unsafe(`delete from ${cfg.tabela} where id = any($1::uuid[]) returning id`, [plano.idsParaRemover]);
        if (removidos.length !== plano.idsParaRemover.length) throw new Error(`removidos ${removidos.length}, esperado exatamente ${plano.idsParaRemover.length} — transação revertida`);
      }

      // 3) upsert de novos e alterados (a fonte oficial prevalece sobre o valor existente)
      const unidadeIds = new Map((await sqlRaw(tx).unsafe(`select id::text as id, codigo from unidades where codigo = any($1::text[])`, [escopo.unidades])).map((u) => [u.codigo as string, u.id as string]));
      const aGravar = [...plano.novos, ...plano.alterados.map((a) => a.depois)];
      for (const l of aGravar) if (!unidadeIds.has(l.unidade)) throw new Error(`unidade ${l.unidade} ausente no banco — transação revertida`);
      const colunas = ["unidade_id", "data", ...cfg.camposChave, "valor"];
      const alvoConflito = ["unidade_id", "data", ...cfg.camposChave].join(", ");
      for (let i = 0; i < aGravar.length; i += 500) {
        const lote = aGravar.slice(i, i + 500);
        const parametros: unknown[] = [];
        const linhasSql = lote.map((l) => {
          const vals = [unidadeIds.get(l.unidade)!, l.data, ...l.chave, textoValor(l.centavos)];
          const marcadores = vals.map((v) => { parametros.push(v); return `$${parametros.length}`; });
          marcadores[0] += "::uuid";
          marcadores[1] += "::date";
          marcadores[marcadores.length - 1] += "::numeric";
          return `(${marcadores.join(", ")})`;
        });
        await sqlRaw(tx).unsafe(
          `insert into ${cfg.tabela} (${colunas.join(", ")}) values ${linhasSql.join(", ")}
           on conflict (${alvoConflito}) do update set valor = excluded.valor, atualizado_em = now()`,
          parametros as never[]
        );
      }

      // 4) validação final, linha a linha, do escopo
      const depois = await lerBancoNoIntervalo(tx, base, escopo.inicio, escopo.fim);
      const esperado = new Map<string, number>();
      for (const l of fonteAgregada(base, fonte)) esperado.set(chaveLinha(l), l.centavos);
      const removiveisPreservados = plano.idsParaRemover.length === 0 ? plano.removiveis : [];
      for (const r of removiveisPreservados) esperado.set(chaveLinha(r), r.centavos);
      const noEscopoDepois = depois.filter((l) => escopo.unidades.includes(l.unidade));
      const divergencias = noEscopoDepois.filter((l) => esperado.get(chaveLinha(l)) !== l.centavos).length;
      if (noEscopoDepois.length !== esperado.size || divergencias > 0) {
        throw new Error(`validação final falhou: ${noEscopoDepois.length} linhas no escopo (esperado ${esperado.size}) e ${divergencias} valor(es) divergente(s) — transação revertida`);
      }
      const totalDepois = noEscopoDepois.reduce((s, l) => s + l.centavos, 0);
      const totalEsperado = [...esperado.values()].reduce((s, v) => s + v, 0);
      if (totalDepois !== totalEsperado) throw new Error(`total do escopo ${textoValor(totalDepois)} difere do esperado ${textoValor(totalEsperado)} — transação revertida`);

      // 5) nada fora do escopo pode ter mudado
      const foraDepois = await hashForaDoEscopo(tx, base, escopo);
      if (foraDepois.n !== foraAntes.n || foraDepois.hash !== foraAntes.hash) throw new Error("registros fora do escopo mudaram — transação revertida");
      return { chaves: noEscopoDepois.length, centavos: totalDepois };
    });
    return { status: "gravado", plano, inseridos: plano.novos.length, atualizados: plano.alterados.length, removidos: plano.idsParaRemover.length, backup, totalNoEscopoDepois: resultado };
  } catch (e) {
    return { status: "revertido", plano, erro: e instanceof Error ? e.message : String(e) };
  }
}

function fonteAgregada(base: BaseSnapshot, fonte: LinhaFonte[]): LinhaFonte[] {
  const cfg = CONFIG_SINCRONIZACAO[base];
  const mapa = new Map<string, LinhaFonte>();
  for (const l of fonte) {
    const k = chaveLinha(l);
    const a = mapa.get(k);
    mapa.set(k, cfg.agregacao === "soma" && a ? { ...a, centavos: a.centavos + l.centavos } : { ...l });
  }
  return [...mapa.values()];
}

export { hashSnapshotBanco };
