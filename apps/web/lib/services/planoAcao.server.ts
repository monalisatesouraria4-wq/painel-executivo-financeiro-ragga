import { and, desc, eq } from "drizzle-orm";
import type { CodigoUnidade } from "@painel/shared";
import { getDb } from "@/lib/db/client";
import { unidades, tratativas } from "@/lib/db/schema";
import { calcularStatusExibicao } from "./planoAcao";
import type { TratativaLinha, FiltroTratativas } from "./planoAcao";

/**
 * Leitura real da tabela `tratativas` (já existente, `lib/db/schema/gestao.ts`).
 * Sem `DATABASE_URL`: lista vazia — nenhum valor inventado, mesmo padrão
 * já usado em `indicadores.server.ts`/`analiseGerencial.server.ts`.
 */
export async function buscarTratativas(filtro: FiltroTratativas = {}): Promise<TratativaLinha[]> {
  if (!process.env.DATABASE_URL) return [];

  const db = getDb();
  const condicoes = [
    filtro.unidade ? eq(unidades.codigo, filtro.unidade) : undefined,
    filtro.indicador ? eq(tratativas.indicador, filtro.indicador) : undefined,
    filtro.status ? eq(tratativas.status, filtro.status) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await db
    .select({
      id: tratativas.id,
      unidade: unidades.codigo,
      indicador: tratativas.indicador,
      dataOcorrencia: tratativas.dataOcorrencia,
      problema: tratativas.problema,
      acao: tratativas.acao,
      responsavel: tratativas.responsavel,
      prazo: tratativas.prazo,
      status: tratativas.status,
      observacao: tratativas.observacao,
      criadoEm: tratativas.criadoEm,
      atualizadoEm: tratativas.atualizadoEm,
    })
    .from(tratativas)
    .innerJoin(unidades, eq(tratativas.unidadeId, unidades.id))
    .where(condicoes.length > 0 ? and(...condicoes) : undefined)
    .orderBy(desc(tratativas.criadoEm));

  return rows.map((r) => ({
    id: r.id,
    unidade: r.unidade as CodigoUnidade,
    indicador: r.indicador,
    dataOcorrencia: r.dataOcorrencia,
    problema: r.problema,
    acao: r.acao,
    responsavel: r.responsavel,
    prazo: r.prazo,
    status: r.status,
    statusExibicao: calcularStatusExibicao(r.status, r.prazo),
    observacao: r.observacao,
    criadoEm: r.criadoEm,
    atualizadoEm: r.atualizadoEm,
  }));
}
