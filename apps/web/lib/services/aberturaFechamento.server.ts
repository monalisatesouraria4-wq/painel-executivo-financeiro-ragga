import { eq, sql } from "drizzle-orm";
import type { CodigoUnidade } from "@painel/shared";
import { getDb } from "@/lib/db/client";
import { unidades, fechamentoCaixa } from "@/lib/db/schema";
import type { AberturaFechamentoData, CaixaAberturaFechamentoLinha } from "./aberturaFechamento";

/**
 * Camada de serviço de "Abertura e Fechamento" — reaproveita 100% a
 * tabela `fechamento_caixa` já validada (mesmo parser/chave/schema do
 * Fechamento em Controles de Caixa, `lib/services/controlesCaixa.ts`),
 * apenas com data escolhida pelo usuário em vez de D-1 fixo.
 *
 * AUDITORIA (feita antes de implementar, conforme pedido): a fonte real
 * (`FECHAMENTO DE CAIXA - ABERTOS_FECHADOS_CONCILIADOS.xlsx`, ver
 * docs/regras-negocio.md linha 287 e parser em
 * lib/import/parsers/fechamentoCaixa.ts) tem a coluna "Situação" com
 * exatamente 3 valores possíveis, confirmados tanto na investigação
 * original quanto no dado real hoje no Supabase: "Aberto", "Fechado",
 * "Conciliado". Cada LINHA da tabela já é um caixa com abertura
 * registrada naquele dia (chave unidade+data+caixa+movimento,
 * confirmado sem duplicidade real na base atual) — não existe, em
 * nenhum lugar do projeto, uma lista separada de "caixas esperados" por
 * loja; por isso "Total de caixas" nesta tela é o total de linhas com
 * abertura na data (não uma meta/roster inventada).
 *
 * Classificação usada (mesma já validada em controlesCaixa.ts, que já
 * trata `situacao === "Aberto"` como o caixa em aberto):
 * - Fechados = Situação in ("Fechado", "Conciliado")
 * - Em aberto = Situação === "Aberto"
 * Sem ambiguidade encontrada nos dados reais (distribuição real no banco:
 * Conciliado 1.137 / Fechado 415 / Aberto 1, em 1.553 linhas totais).
 */
export async function buscarAberturaFechamento(dataSelecionada: Date): Promise<AberturaFechamentoData> {
  const conectado = Boolean(process.env.DATABASE_URL);

  if (!conectado) {
    return {
      conectado: false,
      dataSelecionada,
      dataMaisRecenteDisponivel: null,
      disponivel: false,
      totalCaixas: 0,
      abertos: 0,
      fechados: 0,
      emAberto: 0,
      diferencaFinanceira: 0,
      linhas: [],
    };
  }

  const db = getDb();

  const [{ maxData }] = await db
    .select({ maxData: sql<string | null>`max(${fechamentoCaixa.data})` })
    .from(fechamentoCaixa);
  const dataMaisRecenteDisponivel = maxData ? new Date(maxData) : null;

  const rows = await db
    .select({
      codigo: unidades.codigo,
      caixa: fechamentoCaixa.caixa,
      movimento: fechamentoCaixa.movimento,
      abertura: fechamentoCaixa.abertura,
      fechamento: fechamentoCaixa.fechamento,
      operador: fechamentoCaixa.operador,
      situacao: fechamentoCaixa.situacao,
      difFechamento: fechamentoCaixa.difFechamento,
      difConciliacao: fechamentoCaixa.difConciliacao,
      difTotal: fechamentoCaixa.difTotal,
    })
    .from(fechamentoCaixa)
    .innerJoin(unidades, eq(fechamentoCaixa.unidadeId, unidades.id))
    .where(eq(fechamentoCaixa.data, dataSelecionada))
    .orderBy(unidades.codigo, fechamentoCaixa.caixa);

  const linhas: CaixaAberturaFechamentoLinha[] = rows.map((r) => ({
    unidade: r.codigo as CodigoUnidade,
    caixa: r.caixa,
    movimento: r.movimento,
    operador: r.operador,
    abertura: r.abertura,
    fechamento: r.fechamento,
    situacao: r.situacao ?? "",
    fechado: r.situacao === "Fechado" || r.situacao === "Conciliado",
    difFechamento: r.difFechamento ? Number(r.difFechamento) : null,
    difConciliacao: r.difConciliacao ? Number(r.difConciliacao) : null,
    difTotal: r.difTotal ? Number(r.difTotal) : null,
  }));

  const emAberto = linhas.filter((l) => l.situacao === "Aberto").length;
  const diferencaFinanceira = linhas.reduce((soma, l) => soma + (l.difFechamento ?? 0), 0);

  return {
    conectado: true,
    dataSelecionada,
    dataMaisRecenteDisponivel,
    disponivel: linhas.length > 0,
    totalCaixas: linhas.length,
    abertos: linhas.length,
    fechados: linhas.filter((l) => l.fechado).length,
    emAberto,
    diferencaFinanceira,
    linhas,
  };
}
