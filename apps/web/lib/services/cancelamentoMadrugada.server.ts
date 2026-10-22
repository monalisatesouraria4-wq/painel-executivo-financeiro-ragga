import { and, between, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { unidades, cancelamentoSalaoDetalhe } from "@/lib/db/schema";
import type { EstornoMadrugada } from "@/lib/rules/cancelamentoMadrugada";

/**
 * Consulta do alerta "Cancelamentos após 00h30" (Cancelamento Salão): estornos individuais da janela 00h31–05h59 cuja
 * DATA OFICIAL DO REGISTRO (data do estorno na planilha = `data_calendario`, a mesma do agregado dos demais cards) está no período
 * selecionado. A data operacional (dia anterior) continua sendo CLASSIFICAÇÃO exibida no detalhe, nunca critério do filtro.
 * Somente leitura; tabela adicional `cancelamento_salao_detalhe` (o agregado não é usado nem alterado aqui).
 */
export interface MadrugadaDados {
  conectado: boolean;
  /** Já existem detalhes importados? (false = a base de detalhes ainda não foi carregada). */
  detalhesDisponiveis: boolean;
  /** Menor/maior data operacional dos detalhes (cobertura), ou `null`. */
  cobertura: { desde: string; ate: string } | null;
  linhas: EstornoMadrugada[];
}

export async function buscarCancelamentosMadrugada(inicioOcorrencia: string, fimOcorrencia: string, loja?: string): Promise<MadrugadaDados> {
  if (!process.env.DATABASE_URL) return { conectado: false, detalhesDisponiveis: false, cobertura: null, linhas: [] };
  const db = getDb();
  const tab = cancelamentoSalaoDetalhe;
  const [cob] = await db
    .select({ desde: sql<string | null>`min(${tab.dataCalendario})::text`, ate: sql<string | null>`max(${tab.dataCalendario})::text`, n: sql<number>`count(*)::int` })
    .from(tab);
  if (!cob || cob.n === 0 || !cob.desde || !cob.ate) return { conectado: true, detalhesDisponiveis: false, cobertura: null, linhas: [] };

  const filtros = [eq(tab.madrugada, true), between(tab.dataCalendario, inicioOcorrencia, fimOcorrencia)];
  if (loja && loja !== "TODAS") filtros.push(eq(unidades.codigo, loja));
  const rows = await db
    .select({
      unidade: unidades.codigo,
      dataOperacional: tab.dataOperacional,
      estornoEm: sql<string>`${tab.estornoEm}::text`,
      comanda: tab.comanda,
      produto: tab.produto,
      quantidade: tab.quantidade,
      valor: tab.valor,
      motivo: tab.motivo,
      atendente: tab.atendente,
      autorizador: tab.autorizador,
    })
    .from(tab)
    .innerJoin(unidades, eq(tab.unidadeId, unidades.id))
    .where(and(...filtros));
  return {
    conectado: true,
    detalhesDisponiveis: true,
    cobertura: { desde: cob.desde, ate: cob.ate },
    linhas: rows.map((r) => ({
      unidade: r.unidade as string,
      dataOperacional: r.dataOperacional,
      estornoEm: r.estornoEm.slice(0, 19),
      comanda: r.comanda,
      produto: r.produto,
      quantidade: Number(r.quantidade),
      valor: Number(r.valor),
      motivo: r.motivo,
      atendente: r.atendente,
      autorizador: r.autorizador,
    })),
  };
}
