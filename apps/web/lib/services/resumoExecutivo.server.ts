import { between, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  unidades,
  faturamento,
  formasPagamento,
  brindes,
  cancelamentoSalao,
  cancelamentoDelivery,
  compraDireta,
  retiradaDeposito,
  troco,
  quebraCaixa,
} from "@/lib/db/schema";
import { montarResumoExecutivo, type BaseId, type CoberturaBase, type EntradaPeriodo, type JanelaSemana, type ResumoExecutivo } from "./resumoExecutivo";
import { somarDias, hojeNegocio, validarJanela } from "./resumoSemanal";

/**
 * Consulta do Resumo Semanal EXECUTIVO (somente leitura). Datas de ocorrência exatas [início, fim] da semana segunda→domingo e da
 * semana imediatamente anterior (mesmos 7 dias, sem deslocamento D-1/D-2). Cada base é consultada nas MESMAS tabelas/colunas dos painéis;
 * a agregação e as regras (NOTA FISCAL fora da retirada real, formas de pagamento por categoria, grupos do troco, ciclo 16→15 da quebra)
 * ficam no módulo puro `resumoExecutivo.ts`.
 */

const data = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export interface RespostaResumoExecutivo {
  conectado: boolean;
  resumo: ResumoExecutivo | null;
  erro?: string;
  /** Data/hora da geração (ISO) — exibida no rodapé da imagem. */
  geradoEm: string;
}

async function coberturas(db: ReturnType<typeof getDb>): Promise<Record<BaseId, CoberturaBase>> {
  const linhas = await db.execute<{ base: string; min: string | null; max: string | null }>(sql`
    select 'faturamento' as base, min(${faturamento.data})::text as min, max(${faturamento.data})::text as max from ${faturamento}
    union all select 'formas', min(${formasPagamento.data})::text, max(${formasPagamento.data})::text from ${formasPagamento}
    union all select 'brindes', min(${brindes.data})::text, max(${brindes.data})::text from ${brindes}
    union all select 'cancelamentoSalao', min(${cancelamentoSalao.data})::text, max(${cancelamentoSalao.data})::text from ${cancelamentoSalao}
    union all select 'cancelamentoDelivery', min(${cancelamentoDelivery.data})::text, max(${cancelamentoDelivery.data})::text from ${cancelamentoDelivery}
    union all select 'compraDireta', min(${compraDireta.data})::text, max(${compraDireta.data})::text from ${compraDireta}
    union all select 'retiradaDeposito', min(${retiradaDeposito.data})::text, max(${retiradaDeposito.data})::text from ${retiradaDeposito}
    union all select 'troco', min(${troco.data})::text, max(${troco.data})::text from ${troco}
    union all select 'quebra', min(${quebraCaixa.data})::text, max(${quebraCaixa.data})::text from ${quebraCaixa}
  `);
  const por = (b: BaseId): CoberturaBase => {
    const l = [...linhas].find((x) => x.base === b);
    return { min: l?.min ?? null, max: l?.max ?? null };
  };
  return {
    faturamento: por("faturamento"),
    formas: por("formas"),
    brindes: por("brindes"),
    cancelamentoSalao: por("cancelamentoSalao"),
    cancelamentoDelivery: por("cancelamentoDelivery"),
    compraDireta: por("compraDireta"),
    retiradaDeposito: por("retiradaDeposito"),
    troco: por("troco"),
    quebra: por("quebra"),
  };
}

async function dadosDoPeriodo(db: ReturnType<typeof getDb>, j: JanelaSemana): Promise<EntradaPeriodo> {
  const ini = data(j.inicio);
  const fim = data(j.fim);
  const porMotivo = (t: typeof brindes | typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta) =>
    db
      .select({ motivo: t.motivo, total: sql<string>`sum(${t.valor})` })
      .from(t)
      .where(between(t.data, ini, fim))
      .groupBy(t.motivo);

  const [fat, formas, br, salao, delivery, cd, ret, tr, qb] = await Promise.all([
    db.select({ total: sql<string>`coalesce(sum(${faturamento.valor}), 0)` }).from(faturamento).where(between(faturamento.data, ini, fim)).then((r) => r[0]),
    db.select({ forma: formasPagamento.forma, total: sql<string>`sum(${formasPagamento.valor})` }).from(formasPagamento).where(between(formasPagamento.data, ini, fim)).groupBy(formasPagamento.forma),
    porMotivo(brindes),
    porMotivo(cancelamentoSalao),
    porMotivo(cancelamentoDelivery),
    porMotivo(compraDireta),
    db
      .select({ codigo: unidades.codigo, total: sql<string>`sum(${retiradaDeposito.valor})` })
      .from(retiradaDeposito)
      .innerJoin(unidades, eq(retiradaDeposito.unidadeId, unidades.id))
      .where(between(retiradaDeposito.data, ini, fim))
      .groupBy(unidades.codigo),
    db
      .select({ diferenca: troco.diferenca, conferido: troco.trocoConferidoGerente, informado: troco.trocoInformadoColaborador })
      .from(troco)
      .where(between(troco.data, ini, fim)),
    db
      .select({ data: sql<string>`${quebraCaixa.data}::text`, motivo: quebraCaixa.motivo, valor: quebraCaixa.valor })
      .from(quebraCaixa)
      .where(between(quebraCaixa.data, ini, fim)),
  ]);

  const mot = (rows: { motivo: string; total: string }[]) => rows.map((r) => ({ motivo: r.motivo, valor: Number(r.total) }));
  return {
    faturamentoTotal: Number(fat.total),
    formas: formas.map((r) => ({ forma: r.forma, valor: Number(r.total) })),
    brindes: mot(br),
    cancelamentoSalao: mot(salao),
    cancelamentoDelivery: mot(delivery),
    compraDireta: mot(cd),
    retiradaDeposito: ret.map((r) => ({ unidade: r.codigo, valor: Number(r.total) })),
    troco: tr.map((r) => ({ diferenca: Number(r.diferenca), conferido: Number(r.conferido), informado: Number(r.informado) })),
    quebra: qb.map((r) => ({ data: r.data, motivo: r.motivo, valor: Number(r.valor) })),
  };
}

/** Resumo executivo da semana [inicio, fim] (segunda→domingo, já validada) × semana imediatamente anterior. */
export async function buscarResumoExecutivo(atual: JanelaSemana): Promise<RespostaResumoExecutivo> {
  const geradoEm = new Date().toISOString();
  const erro = validarJanela(atual, hojeNegocio());
  if (erro) return { conectado: Boolean(process.env.DATABASE_URL), resumo: null, erro, geradoEm };
  if (!process.env.DATABASE_URL) return { conectado: false, resumo: null, geradoEm };

  const db = getDb();
  const anterior: JanelaSemana = { inicio: somarDias(atual.inicio, -7), fim: somarDias(atual.inicio, -1) };
  const [bases, dadosAtual, dadosAnterior] = await Promise.all([coberturas(db), dadosDoPeriodo(db, atual), dadosDoPeriodo(db, anterior)]);
  return { conectado: true, resumo: montarResumoExecutivo({ atual, anterior, bases, dadosAtual, dadosAnterior }), geradoEm };
}
