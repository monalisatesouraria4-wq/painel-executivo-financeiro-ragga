import { between, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { unidades, faturamento, quebraCaixa } from "@/lib/db/schema";
import type { LinhaQuebraBruta, QuebraComparativoDados } from "./quebraPainel";

/**
 * Consulta do PERÍODO COMPARADO da análise de Quebra por loja (+ faturamento por loja dos dois períodos, para o % sobre
 * o faturamento). O período ATUAL da Quebra vem dos serviços existentes de Controles de Caixa (ciclo 16→15 ou intervalo
 * escolhido) — aqui nada dessa regra é alterado. Datas exatas (sem deslocamento), como o Faturamento nas demais telas.
 * Consultas simples por loja/dia (sem joins que multipliquem linhas): quebra por `unidade_id` e faturamento agregado
 * por loja.
 */

async function faturamentoPorLoja(db: ReturnType<typeof getDb>, ini: Date, fim: Date): Promise<Record<string, number>> {
  const linhas = await db
    .select({ codigo: unidades.codigo, total: sql<string>`coalesce(sum(${faturamento.valor}), 0)` })
    .from(faturamento)
    .innerJoin(unidades, eq(faturamento.unidadeId, unidades.id))
    .where(between(faturamento.data, ini, fim))
    .groupBy(unidades.codigo);
  return Object.fromEntries(linhas.map((l) => [l.codigo, Number(l.total)]));
}

export async function buscarQuebraComparativo(
  atualInicio: Date,
  atualFim: Date,
  comparacaoInicio: Date,
  comparacaoFim: Date
): Promise<QuebraComparativoDados> {
  const conectado = Boolean(process.env.DATABASE_URL);
  const vazio: QuebraComparativoDados = { conectado, faturamentoAtual: {}, comparacao: { linhas: [], faturamento: {} }, quebraDesde: null };
  if (!conectado) return vazio;

  const db = getDb();
  const [fatAtual, fatComp, linhasComp, [primeira]] = await Promise.all([
    faturamentoPorLoja(db, atualInicio, atualFim),
    faturamentoPorLoja(db, comparacaoInicio, comparacaoFim),
    db
      .select({ codigo: unidades.codigo, operador: quebraCaixa.operador, cpf: quebraCaixa.cpf, motivo: quebraCaixa.motivo, valor: quebraCaixa.valor })
      .from(quebraCaixa)
      .innerJoin(unidades, eq(quebraCaixa.unidadeId, unidades.id))
      .where(between(quebraCaixa.data, comparacaoInicio, comparacaoFim)),
    db.select({ min: sql<string | null>`min(${quebraCaixa.data})::text` }).from(quebraCaixa),
  ]);

  const linhas: LinhaQuebraBruta[] = linhasComp.map((r) => ({
    unidade: r.codigo,
    operador: r.operador,
    cpf: r.cpf,
    motivo: r.motivo,
    valor: Number(r.valor),
  }));

  return { conectado, faturamentoAtual: fatAtual, comparacao: { linhas, faturamento: fatComp }, quebraDesde: primeira?.min ?? null };
}
