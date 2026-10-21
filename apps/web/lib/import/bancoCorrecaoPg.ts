import type postgres from "postgres";
import type { BancoCorrecao, RegistroBanco, SnapshotCorrecao } from "./correcaoChave";

/**
 * Camada SQL REAL da correção controlada (postgres.js). Fica em `lib` para que o comando `atualizar-bases` e o teste de
 * integração (PostgreSQL local descartável) usem exatamente o mesmo código.
 */

export type Snap = Record<string, { n: number; hash: string }>;

/** Tabelas cuja contagem + hash são conferidos antes/depois da correção. */
export const TABELAS_REFERENCIA_PADRAO = [
  "brindes", "cancelamento_salao", "cancelamento_delivery", "compra_direta", "conferencia", "quebra_caixa",
  "fechamento_caixa", "pdv_maquininha", "retirada_deposito", "troco", "faturamento", "cancelamento_salao_detalhe",
];

export async function snapshot(sql: postgres.Sql, tabelas: string[]): Promise<Snap> {
  const out: Snap = {};
  for (const t of tabelas) {
    const [r] = await sql.unsafe(
      `select count(*)::int n, md5(coalesce(string_agg(j, ',' order by j), '')) h from (select (to_jsonb(x) - 'id' - 'criado_em' - 'atualizado_em' - 'importacao_id' - 'fonte_periodo_id')::text j from ${t} x) s`
    );
    out[t] = { n: r.n as number, hash: r.h as string };
  }
  return out;
}

/** Banco real para a correção controlada (consultas por ID; exclusão por ID dentro de UMA transação). */
export function bancoCorrecaoPg(sql: postgres.Sql, TABELAS_REFERENCIA: string[] = TABELAS_REFERENCIA_PADRAO): BancoCorrecao {
  // os IDs já passaram por `validarPlano` (formato UUID) antes de chegar aqui
  const lista = (ids: string[]) => ids.map((id) => `'${id}'::uuid`).join(",");
  type Q = postgres.Sql | postgres.TransactionSql;
  const hashSemAlvos = async (q: Q, ids: string[]) => {
    const [r] = await (q as postgres.Sql).unsafe(
      `select count(*)::int n, md5(coalesce(string_agg(j, ',' order by j), '')) h from (select to_jsonb(x)::text j from compra_direta x where x.id not in (${lista(ids)})) s`
    );
    return { n: r.n as number, hash: r.h as string };
  };
  const buscarPorIds = async (q: Q, ids: string[], travar: boolean): Promise<RegistroBanco[]> => {
    const rows = await (q as postgres.Sql).unsafe(
      `select x.id::text as id, u.codigo as unidade, x.data::text as data, x.motivo, x.valor::text as valor, to_jsonb(x) as completo from compra_direta x join unidades u on u.id = x.unidade_id where x.id in (${lista(ids)})${travar ? " for update of x" : ""}`
    );
    return rows.map((r) => ({ id: r.id as string, unidade: r.unidade as string, data: r.data as string, motivo: r.motivo as string, valor: r.valor as string, completo: r.completo as Record<string, unknown> }));
  };
  const buscarDoDia = async (q: Q, unidade: string, data: string, travar = false) => {
    const rows = travar
      ? await (q as postgres.Sql)`select x.motivo, x.valor::text as valor from compra_direta x join unidades u on u.id = x.unidade_id where u.codigo = ${unidade} and x.data = ${data}::date for update of x`
      : await (q as postgres.Sql)`select x.motivo, x.valor::text as valor from compra_direta x join unidades u on u.id = x.unidade_id where u.codigo = ${unidade} and x.data = ${data}::date`;
    return rows.map((r) => ({ motivo: r.motivo as string, valor: r.valor as string }));
  };
  return {
    buscarPorIds: (ids) => buscarPorIds(sql, ids, false),
    buscarDoDia: (u, d) => buscarDoDia(sql, u, d),
    snapshot: async (idsAlvo): Promise<SnapshotCorrecao> => {
      const tabelas = await snapshot(sql, TABELAS_REFERENCIA);
      return { tabelas, compraDiretaSemAlvos: await hashSemAlvos(sql, idsAlvo) };
    },
    transacao: async (fn) =>
      sql.begin(async (tx) =>
        fn({
          buscarPorIds: (ids) => buscarPorIds(tx, ids, true),
          buscarDoDia: (u, d) => buscarDoDia(tx, u, d, true),
          snapshotSemAlvos: (ids) => hashSemAlvos(tx, ids),
          deletarPorIds: async (ids) => (await tx.unsafe(`delete from compra_direta where id in (${lista(ids)}) returning id`)).length,
          contarCompraDireta: async () => Number((await tx.unsafe("select count(*)::int n from compra_direta"))[0].n),
        })
      ) as never,
  };
}

