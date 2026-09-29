import { and, between, eq, inArray, sql } from "drizzle-orm";
import type { TipoBase } from "@painel/shared";
import { getDb } from "./client";
import {
  unidades,
  faturamento,
  brindes,
  cancelamentoSalao,
  cancelamentoDelivery,
  compraDireta,
  retiradaDeposito,
  fechamentoCaixa,
  pdvMaquininha,
  troco,
  conferencia,
  quebraCaixa,
  formasPagamento,
  fontesPorPeriodo,
  tratativas,
} from "./schema";
import type { NovaTratativaInput, AtualizarTratativaInput } from "@/lib/services/planoAcao";
import { simularGravacao, chaveDoRegistro, type ResultadoGravacaoSimulada } from "@/lib/import/simularGravacao";
import { CHAVES_POR_BASE } from "@/lib/rules/chaves";
import type { RegistroBase } from "@/lib/import/tipos";

/**
 * Persistência real no Postgres para as 6 bases do lote da Visão Geral
 * (faturamento, brindes, cancelamento_salao, cancelamento_delivery,
 * compra_direta, retirada_deposito). Usa exatamente as chaves já
 * validadas em `lib/rules/chaves.ts` (via as constraints UNIQUE do
 * schema/migration, que têm os MESMOS campos) — nenhuma chave nova,
 * nenhum parser alterado.
 *
 * Estratégia: upsert por chave (`ON CONFLICT ... DO UPDATE`), igual à
 * regra já validada (`estrategiaGravacao`/`CHAVES_POR_BASE` — todas as
 * bases hoje usam upsert_por_chave). As contagens de inseridos/
 * atualizados são calculadas com `simularGravacao` (já testada) sobre o
 * estado existente no banco dentro da janela unidade+data do lote
 * importado, para não reimplementar essa lógica em SQL.
 *
 * Sem `DATABASE_URL`: estas funções nunca são chamadas (guardadas pelo
 * chamador, `lib/services/atualizacaoBases.ts`).
 */

export interface ResultadoPersistencia extends ResultadoGravacaoSimulada {
  tipoBase: TipoBase;
}

/**
 * Deduplica o lote pela MESMA chave já validada (`CHAVES_POR_BASE`),
 * última ocorrência vence — igual a `aplicarGravacao`/legado. Necessário
 * porque `INSERT ... ON CONFLICT DO UPDATE` do Postgres rejeita um lote
 * com duas linhas de mesma chave ("cannot affect row a second time");
 * o arquivo real de Troco tem colisões de chave dentro do próprio
 * arquivo (já documentado, ver docs/regras-negocio.md — investigação
 * das 66 colisões). Não é uma chave nova nem uma regra de negócio nova,
 * só a aplicação, antes do INSERT, da mesma política de merge já usada
 * em memória.
 */
function deduplicarPorChave(tipoBase: TipoBase, registros: RegistroBase[]): RegistroBase[] {
  const camposChave = CHAVES_POR_BASE[tipoBase];
  const porChave = new Map<string, RegistroBase>();
  for (const r of registros) porChave.set(chaveDoRegistro(r, camposChave), r);
  return [...porChave.values()];
}

async function garantirUnidades(db: ReturnType<typeof getDb>, codigos: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(codigos)];
  if (unicos.length === 0) return new Map();

  await db
    .insert(unidades)
    .values(unicos.map((codigo) => ({ codigo, nome: codigo })))
    .onConflictDoNothing({ target: unidades.codigo });

  const linhas = await db
    .select({ id: unidades.id, codigo: unidades.codigo })
    .from(unidades)
    .where(inArray(unidades.codigo, unicos));

  return new Map(linhas.map((l) => [l.codigo, l.id]));
}

function janelaData(registros: RegistroBase[]): { min: Date; max: Date } {
  const tempos = registros.map((r) => r.data.getTime());
  return { min: new Date(Math.min(...tempos)), max: new Date(Math.max(...tempos)) };
}

/** Calcula inseridos/atualizados/totalFinal reaproveitando simularGravacao (já testada), sem reimplementar a lógica de chave. */
function calcularContagens(
  tipoBase: TipoBase,
  registrosNovos: RegistroBase[],
  estadoExistenteNaJanela: RegistroBase[]
): ResultadoGravacaoSimulada {
  return simularGravacao(tipoBase, registrosNovos, estadoExistenteNaJanela);
}

export async function persistirFaturamento(registros: RegistroBase[]): Promise<ResultadoPersistencia> {
  const db = getDb();
  const unidadeIdPorCodigo = await garantirUnidades(db, registros.map((r) => r.unidade));
  const { min, max } = janelaData(registros);

  const idsNaJanela = [...unidadeIdPorCodigo.values()];
  const existentes = await db
    .select({ codigo: unidades.codigo, data: faturamento.data, valor: faturamento.valor })
    .from(faturamento)
    .innerJoin(unidades, eq(faturamento.unidadeId, unidades.id))
    .where(and(inArray(faturamento.unidadeId, idsNaJanela), between(faturamento.data, min, max)));

  const estadoExistente: RegistroBase[] = existentes.map((e) => ({
    unidade: e.codigo as RegistroBase["unidade"],
    data: e.data,
    valor: Number(e.valor),
    extras: {},
    linhaOrigem: 0,
  }));

  await db
    .insert(faturamento)
    .values(
      deduplicarPorChave("faturamento", registros).map((r) => ({
        unidadeId: unidadeIdPorCodigo.get(r.unidade)!,
        data: r.data,
        valor: String(r.valor),
      }))
    )
    .onConflictDoUpdate({
      target: [faturamento.unidadeId, faturamento.data],
      set: { valor: sql`excluded.valor`, atualizadoEm: sql`now()` },
    });

  return { tipoBase: "faturamento", ...calcularContagens("faturamento", registros, estadoExistente) };
}

async function persistirListaSimplesComMotivo(
  tipoBase: TipoBase,
  tabela: typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta,
  registros: RegistroBase[]
): Promise<ResultadoPersistencia> {
  const db = getDb();
  const unidadeIdPorCodigo = await garantirUnidades(db, registros.map((r) => r.unidade));
  const { min, max } = janelaData(registros);
  const idsNaJanela = [...unidadeIdPorCodigo.values()];

  const existentes = await db
    .select({ codigo: unidades.codigo, data: tabela.data, motivo: tabela.motivo, valor: tabela.valor })
    .from(tabela)
    .innerJoin(unidades, eq(tabela.unidadeId, unidades.id))
    .where(and(inArray(tabela.unidadeId, idsNaJanela), between(tabela.data, min, max)));

  const estadoExistente: RegistroBase[] = existentes.map((e) => ({
    unidade: e.codigo as RegistroBase["unidade"],
    data: e.data,
    valor: Number(e.valor),
    extras: { motivo: e.motivo },
    linhaOrigem: 0,
  }));

  await db
    .insert(tabela)
    .values(
      deduplicarPorChave(tipoBase, registros).map((r) => ({
        unidadeId: unidadeIdPorCodigo.get(r.unidade)!,
        data: r.data,
        motivo: r.extras.motivo ?? "",
        valor: String(r.valor),
      }))
    )
    .onConflictDoUpdate({
      target: [tabela.unidadeId, tabela.data, tabela.motivo],
      set: { valor: sql`excluded.valor`, atualizadoEm: sql`now()` },
    });

  return { tipoBase, ...calcularContagens(tipoBase, registros, estadoExistente) };
}

export function persistirCancelamentoSalao(registros: RegistroBase[]) {
  return persistirListaSimplesComMotivo("cancelamento_salao", cancelamentoSalao, registros);
}
export function persistirCancelamentoDelivery(registros: RegistroBase[]) {
  return persistirListaSimplesComMotivo("cancelamento_delivery", cancelamentoDelivery, registros);
}
export function persistirCompraDireta(registros: RegistroBase[]) {
  return persistirListaSimplesComMotivo("compra_direta", compraDireta, registros);
}

/**
 * Formas de Pagamento — mesma fonte do Faturamento (VENDAS.xlsx), mesmo
 * parser (`parseFormasPagamento`), agregado por Filial+Data+`Desc.
 * pagam.` (campo `forma`, texto bruto — a classificação nas 8 categorias
 * do painel acontece só na leitura, nunca na persistência). Chave já
 * existente em `CHAVES_POR_BASE.formas_pagamento` — não criada agora.
 */
export async function persistirFormasPagamento(registros: RegistroBase[]): Promise<ResultadoPersistencia> {
  const db = getDb();
  const unidadeIdPorCodigo = await garantirUnidades(db, registros.map((r) => r.unidade));
  const { min, max } = janelaData(registros);
  const idsNaJanela = [...unidadeIdPorCodigo.values()];

  const existentes = await db
    .select({ codigo: unidades.codigo, data: formasPagamento.data, forma: formasPagamento.forma, valor: formasPagamento.valor })
    .from(formasPagamento)
    .innerJoin(unidades, eq(formasPagamento.unidadeId, unidades.id))
    .where(and(inArray(formasPagamento.unidadeId, idsNaJanela), between(formasPagamento.data, min, max)));

  const estadoExistente: RegistroBase[] = existentes.map((e) => ({
    unidade: e.codigo as RegistroBase["unidade"],
    data: e.data,
    valor: Number(e.valor),
    extras: { forma: e.forma },
    linhaOrigem: 0,
  }));

  await db
    .insert(formasPagamento)
    .values(
      deduplicarPorChave("formas_pagamento", registros).map((r) => ({
        unidadeId: unidadeIdPorCodigo.get(r.unidade)!,
        data: r.data,
        forma: r.extras.forma ?? "",
        valor: String(r.valor),
      }))
    )
    .onConflictDoUpdate({
      target: [formasPagamento.unidadeId, formasPagamento.data, formasPagamento.forma],
      set: { valor: sql`excluded.valor`, atualizadoEm: sql`now()` },
    });

  return { tipoBase: "formas_pagamento", ...calcularContagens("formas_pagamento", registros, estadoExistente) };
}

export async function persistirBrindes(registros: RegistroBase[]): Promise<ResultadoPersistencia> {
  const db = getDb();
  const unidadeIdPorCodigo = await garantirUnidades(db, registros.map((r) => r.unidade));
  const { min, max } = janelaData(registros);
  const idsNaJanela = [...unidadeIdPorCodigo.values()];

  const existentes = await db
    .select({
      codigo: unidades.codigo,
      data: brindes.data,
      motivo: brindes.motivo,
      motivo2: brindes.motivo2,
      valor: brindes.valor,
    })
    .from(brindes)
    .innerJoin(unidades, eq(brindes.unidadeId, unidades.id))
    .where(and(inArray(brindes.unidadeId, idsNaJanela), between(brindes.data, min, max)));

  const estadoExistente: RegistroBase[] = existentes.map((e) => ({
    unidade: e.codigo as RegistroBase["unidade"],
    data: e.data,
    valor: Number(e.valor),
    extras: { motivo: e.motivo, motivo2: e.motivo2 },
    linhaOrigem: 0,
  }));

  await db
    .insert(brindes)
    .values(
      deduplicarPorChave("brindes", registros).map((r) => ({
        unidadeId: unidadeIdPorCodigo.get(r.unidade)!,
        data: r.data,
        motivo: r.extras.motivo ?? "",
        motivo2: r.extras.motivo2 ?? "",
        valor: String(r.valor),
      }))
    )
    .onConflictDoUpdate({
      target: [brindes.unidadeId, brindes.data, brindes.motivo, brindes.motivo2],
      set: { valor: sql`excluded.valor`, atualizadoEm: sql`now()` },
    });

  return { tipoBase: "brindes", ...calcularContagens("brindes", registros, estadoExistente) };
}

export async function persistirRetiradaDeposito(registros: RegistroBase[]): Promise<ResultadoPersistencia> {
  const db = getDb();
  const unidadeIdPorCodigo = await garantirUnidades(db, registros.map((r) => r.unidade));
  const { min, max } = janelaData(registros);
  const idsNaJanela = [...unidadeIdPorCodigo.values()];

  const existentes = await db
    .select({
      codigo: unidades.codigo,
      data: retiradaDeposito.data,
      caixa: retiradaDeposito.caixa,
      motivo: retiradaDeposito.motivo,
      motivoDescricao: retiradaDeposito.motivoDescricao,
      usuario: retiradaDeposito.usuario,
      usuarioAutorizador: retiradaDeposito.usuarioAutorizador,
      valor: retiradaDeposito.valor,
    })
    .from(retiradaDeposito)
    .innerJoin(unidades, eq(retiradaDeposito.unidadeId, unidades.id))
    .where(and(inArray(retiradaDeposito.unidadeId, idsNaJanela), between(retiradaDeposito.data, min, max)));

  const estadoExistente: RegistroBase[] = existentes.map((e) => ({
    unidade: e.codigo as RegistroBase["unidade"],
    data: e.data,
    valor: Number(e.valor),
    extras: {
      caixa: e.caixa,
      motivo: e.motivo,
      motivo_descricao: e.motivoDescricao,
      usuario: e.usuario,
      usuario_autorizador: e.usuarioAutorizador,
    },
    linhaOrigem: 0,
  }));

  await db
    .insert(retiradaDeposito)
    .values(
      deduplicarPorChave("retirada_deposito", registros).map((r) => ({
        unidadeId: unidadeIdPorCodigo.get(r.unidade)!,
        data: r.data,
        valor: String(r.valor),
        caixa: r.extras.caixa ?? "",
        motivo: r.extras.motivo ?? "",
        motivoDescricao: r.extras.motivo_descricao ?? "",
        usuario: r.extras.usuario ?? "",
        usuarioAutorizador: r.extras.usuario_autorizador ?? "",
      }))
    )
    .onConflictDoUpdate({
      target: [
        retiradaDeposito.unidadeId,
        retiradaDeposito.data,
        retiradaDeposito.caixa,
        retiradaDeposito.motivo,
        retiradaDeposito.motivoDescricao,
        retiradaDeposito.usuario,
        retiradaDeposito.usuarioAutorizador,
      ],
      set: { valor: sql`excluded.valor`, atualizadoEm: sql`now()` },
    });

  return { tipoBase: "retirada_deposito", ...calcularContagens("retirada_deposito", registros, estadoExistente) };
}

export async function persistirFechamento(registros: RegistroBase[]): Promise<ResultadoPersistencia> {
  const db = getDb();
  const unidadeIdPorCodigo = await garantirUnidades(db, registros.map((r) => r.unidade));
  const { min, max } = janelaData(registros);
  const idsNaJanela = [...unidadeIdPorCodigo.values()];

  const existentes = await db
    .select({ codigo: unidades.codigo, data: fechamentoCaixa.data, caixa: fechamentoCaixa.caixa, movimento: fechamentoCaixa.movimento })
    .from(fechamentoCaixa)
    .innerJoin(unidades, eq(fechamentoCaixa.unidadeId, unidades.id))
    .where(and(inArray(fechamentoCaixa.unidadeId, idsNaJanela), between(fechamentoCaixa.data, min, max)));

  const estadoExistente: RegistroBase[] = existentes.map((e) => ({
    unidade: e.codigo as RegistroBase["unidade"],
    data: e.data,
    valor: 0,
    extras: { caixa: e.caixa, movimento: e.movimento },
    linhaOrigem: 0,
  }));

  await db
    .insert(fechamentoCaixa)
    .values(
      deduplicarPorChave("fechamento_caixa", registros).map((r) => ({
        unidadeId: unidadeIdPorCodigo.get(r.unidade)!,
        data: r.data,
        caixa: r.extras.caixa ?? "",
        movimento: r.extras.movimento ?? "",
        abertura: r.extras.abertura || null,
        fechamento: r.extras.fechamento || null,
        operador: r.extras.operador || null,
        situacao: r.extras.situacao || null,
        difFechamento: r.extras.difFechamento ? r.extras.difFechamento : null,
        difConciliacao: r.extras.difConciliacao ? r.extras.difConciliacao : null,
        difTotal: r.extras.difTotal ? r.extras.difTotal : null,
      }))
    )
    .onConflictDoUpdate({
      target: [fechamentoCaixa.unidadeId, fechamentoCaixa.data, fechamentoCaixa.caixa, fechamentoCaixa.movimento],
      set: {
        abertura: sql`excluded.abertura`,
        fechamento: sql`excluded.fechamento`,
        operador: sql`excluded.operador`,
        situacao: sql`excluded.situacao`,
        difFechamento: sql`excluded.dif_fechamento`,
        difConciliacao: sql`excluded.dif_conciliacao`,
        difTotal: sql`excluded.dif_total`,
        atualizadoEm: sql`now()`,
      },
    });

  return { tipoBase: "fechamento_caixa", ...calcularContagens("fechamento_caixa", registros, estadoExistente) };
}

export async function persistirPdvMaquininha(registros: RegistroBase[]): Promise<ResultadoPersistencia> {
  const db = getDb();
  const unidadeIdPorCodigo = await garantirUnidades(db, registros.map((r) => r.unidade));
  const { min, max } = janelaData(registros);
  const idsNaJanela = [...unidadeIdPorCodigo.values()];

  const existentes = await db
    .select({
      codigo: unidades.codigo,
      data: pdvMaquininha.data,
      formaPagamento: pdvMaquininha.formaPagamento,
      valorPdv: pdvMaquininha.valorPdv,
    })
    .from(pdvMaquininha)
    .innerJoin(unidades, eq(pdvMaquininha.unidadeId, unidades.id))
    .where(and(inArray(pdvMaquininha.unidadeId, idsNaJanela), between(pdvMaquininha.data, min, max)));

  const estadoExistente: RegistroBase[] = existentes.map((e) => ({
    unidade: e.codigo as RegistroBase["unidade"],
    data: e.data,
    valor: Number(e.valorPdv),
    extras: { forma_pagamento: e.formaPagamento },
    linhaOrigem: 0,
  }));

  await db
    .insert(pdvMaquininha)
    .values(
      deduplicarPorChave("pdv_maquininha", registros).map((r) => ({
        unidadeId: unidadeIdPorCodigo.get(r.unidade)!,
        data: r.data,
        formaPagamento: r.extras.forma_pagamento ?? "",
        valorPdv: String(r.valor),
        valorMaquininha: r.extras.valorMaquininha ?? "0",
      }))
    )
    .onConflictDoUpdate({
      target: [pdvMaquininha.unidadeId, pdvMaquininha.data, pdvMaquininha.formaPagamento],
      set: { valorPdv: sql`excluded.valor_pdv`, valorMaquininha: sql`excluded.valor_maquininha`, atualizadoEm: sql`now()` },
    });

  return { tipoBase: "pdv_maquininha", ...calcularContagens("pdv_maquininha", registros, estadoExistente) };
}

export async function persistirTroco(registros: RegistroBase[]): Promise<ResultadoPersistencia> {
  const db = getDb();
  const unidadeIdPorCodigo = await garantirUnidades(db, registros.map((r) => r.unidade));
  const { min, max } = janelaData(registros);
  const idsNaJanela = [...unidadeIdPorCodigo.values()];

  const existentes = await db
    .select({ codigo: unidades.codigo, data: troco.data, caixa: troco.caixa, trocoConferidoGerente: troco.trocoConferidoGerente })
    .from(troco)
    .innerJoin(unidades, eq(troco.unidadeId, unidades.id))
    .where(and(inArray(troco.unidadeId, idsNaJanela), between(troco.data, min, max)));

  const estadoExistente: RegistroBase[] = existentes.map((e) => ({
    unidade: e.codigo as RegistroBase["unidade"],
    data: e.data,
    valor: Number(e.trocoConferidoGerente),
    extras: { caixa: e.caixa },
    linhaOrigem: 0,
  }));

  await db
    .insert(troco)
    .values(
      deduplicarPorChave("troco", registros).map((r) => ({
        unidadeId: unidadeIdPorCodigo.get(r.unidade)!,
        data: r.data,
        caixa: r.extras.caixa ?? "",
        trocoConferidoGerente: String(r.valor),
        trocoInformadoColaborador: r.extras.trocoInformadoColaborador ?? "0",
        diferenca: r.extras.diferenca ?? "0",
        operador: r.extras.operador || null,
        planoDeAcao: r.extras.plano_de_acao || null,
      }))
    )
    .onConflictDoUpdate({
      target: [troco.unidadeId, troco.data, troco.caixa],
      set: {
        trocoConferidoGerente: sql`excluded.troco_conferido_gerente`,
        trocoInformadoColaborador: sql`excluded.troco_informado_colaborador`,
        diferenca: sql`excluded.diferenca`,
        operador: sql`excluded.operador`,
        planoDeAcao: sql`excluded.plano_de_acao`,
        atualizadoEm: sql`now()`,
      },
    });

  return { tipoBase: "troco", ...calcularContagens("troco", registros, estadoExistente) };
}

export interface FonteConferencia {
  arquivoNome: string;
  nomeAba: string;
  periodoInicio: Date;
  periodoFim: Date;
}

export async function persistirConferencia(
  registros: RegistroBase[],
  fonte: FonteConferencia
): Promise<ResultadoPersistencia> {
  const db = getDb();

  // fontesPorPeriodo: upsert (tipo_base, arquivo_nome, nome_aba) já validado no schema — sem chave nova.
  await db
    .insert(fontesPorPeriodo)
    .values({
      tipoBase: "conferencia",
      arquivoNome: fonte.arquivoNome,
      nomeAba: fonte.nomeAba,
      periodoInicio: fonte.periodoInicio,
      periodoFim: fonte.periodoFim,
    })
    .onConflictDoNothing({ target: [fontesPorPeriodo.tipoBase, fontesPorPeriodo.arquivoNome, fontesPorPeriodo.nomeAba] });

  const [fonteRow] = await db
    .select({ id: fontesPorPeriodo.id })
    .from(fontesPorPeriodo)
    .where(
      and(
        eq(fontesPorPeriodo.tipoBase, "conferencia"),
        eq(fontesPorPeriodo.arquivoNome, fonte.arquivoNome),
        eq(fontesPorPeriodo.nomeAba, fonte.nomeAba)
      )
    );
  const fonteId = fonteRow.id;

  const unidadeIdPorCodigo = await garantirUnidades(db, registros.map((r) => r.unidade));
  const { min, max } = janelaData(registros);
  const idsNaJanela = [...unidadeIdPorCodigo.values()];

  const existentes = await db
    .select({ codigo: unidades.codigo, data: conferencia.data })
    .from(conferencia)
    .innerJoin(unidades, eq(conferencia.unidadeId, unidades.id))
    .where(and(inArray(conferencia.unidadeId, idsNaJanela), between(conferencia.data, min, max)));

  const estadoExistente: RegistroBase[] = existentes.map((e) => ({
    unidade: e.codigo as RegistroBase["unidade"],
    data: e.data,
    valor: 0,
    extras: {},
    linhaOrigem: 0,
  }));

  await db
    .insert(conferencia)
    .values(
      deduplicarPorChave("conferencia", registros).map((r) => ({
        unidadeId: unidadeIdPorCodigo.get(r.unidade)!,
        data: r.data,
        qtdCadastrados: Number(r.extras.qtdCadastrados),
        qtdConferidos: r.extras.qtdConferidos === "" ? null : Number(r.extras.qtdConferidos),
        emAtraso: r.extras.emAtraso === "true",
        respConferencia: r.extras.respConferencia || null,
        fontePeriodoId: fonteId,
      }))
    )
    .onConflictDoUpdate({
      target: [conferencia.unidadeId, conferencia.data],
      set: {
        qtdCadastrados: sql`excluded.qtd_cadastrados`,
        qtdConferidos: sql`excluded.qtd_conferidos`,
        emAtraso: sql`excluded.em_atraso`,
        respConferencia: sql`excluded.resp_conferencia`,
        fontePeriodoId: sql`excluded.fonte_periodo_id`,
        atualizadoEm: sql`now()`,
      },
    });

  return { tipoBase: "conferencia", ...calcularContagens("conferencia", registros, estadoExistente) };
}

export interface FonteQuebraCaixa {
  arquivoNome: string;
  nomeAba: string;
  periodoInicio: Date;
  periodoFim: Date;
}

/**
 * Persistência de Quebra de Caixa — mesmo padrão de `persistirConferencia`
 * (fonte por período/aba registrada em `fontesPorPeriodo`, upsert por
 * chave). Chave já validada em `CHAVES_POR_BASE.quebra_caixa`
 * (unidade+data+conferente+operador+cpf+motivo — o valor da quebra nunca
 * entra na chave), nenhuma chave nova.
 */
export async function persistirQuebraCaixa(
  registros: RegistroBase[],
  fonte: FonteQuebraCaixa
): Promise<ResultadoPersistencia> {
  const db = getDb();

  await db
    .insert(fontesPorPeriodo)
    .values({
      tipoBase: "quebra_caixa",
      arquivoNome: fonte.arquivoNome,
      nomeAba: fonte.nomeAba,
      periodoInicio: fonte.periodoInicio,
      periodoFim: fonte.periodoFim,
    })
    .onConflictDoNothing({ target: [fontesPorPeriodo.tipoBase, fontesPorPeriodo.arquivoNome, fontesPorPeriodo.nomeAba] });

  const [fonteRow] = await db
    .select({ id: fontesPorPeriodo.id })
    .from(fontesPorPeriodo)
    .where(
      and(
        eq(fontesPorPeriodo.tipoBase, "quebra_caixa"),
        eq(fontesPorPeriodo.arquivoNome, fonte.arquivoNome),
        eq(fontesPorPeriodo.nomeAba, fonte.nomeAba)
      )
    );
  const fonteId = fonteRow.id;

  const unidadeIdPorCodigo = await garantirUnidades(db, registros.map((r) => r.unidade));
  const { min, max } = janelaData(registros);
  const idsNaJanela = [...unidadeIdPorCodigo.values()];

  const existentes = await db
    .select({
      codigo: unidades.codigo,
      data: quebraCaixa.data,
      conferente: quebraCaixa.conferente,
      operador: quebraCaixa.operador,
      cpf: quebraCaixa.cpf,
      motivo: quebraCaixa.motivo,
      valor: quebraCaixa.valor,
    })
    .from(quebraCaixa)
    .innerJoin(unidades, eq(quebraCaixa.unidadeId, unidades.id))
    .where(and(inArray(quebraCaixa.unidadeId, idsNaJanela), between(quebraCaixa.data, min, max)));

  const estadoExistente: RegistroBase[] = existentes.map((e) => ({
    unidade: e.codigo as RegistroBase["unidade"],
    data: e.data,
    valor: Number(e.valor),
    extras: { conferente: e.conferente, operador: e.operador, cpf: e.cpf, motivo: e.motivo },
    linhaOrigem: 0,
  }));

  await db
    .insert(quebraCaixa)
    .values(
      deduplicarPorChave("quebra_caixa", registros).map((r) => ({
        unidadeId: unidadeIdPorCodigo.get(r.unidade)!,
        data: r.data,
        valor: String(r.valor),
        conferente: r.extras.conferente ?? "",
        operador: r.extras.operador ?? "",
        cpf: r.extras.cpf ?? "",
        motivo: r.extras.motivo ?? "",
        fontePeriodoId: fonteId,
      }))
    )
    .onConflictDoUpdate({
      target: [
        quebraCaixa.unidadeId,
        quebraCaixa.data,
        quebraCaixa.conferente,
        quebraCaixa.operador,
        quebraCaixa.cpf,
        quebraCaixa.motivo,
      ],
      set: { valor: sql`excluded.valor`, fontePeriodoId: sql`excluded.fonte_periodo_id`, atualizadoEm: sql`now()` },
    });

  return { tipoBase: "quebra_caixa", ...calcularContagens("quebra_caixa", registros, estadoExistente) };
}

/**
 * Plano de Ação (`tratativas`, já existente antes desta etapa). CRUD
 * simples de um único registro por vez — não é um lote de importação,
 * por isso não usa `simularGravacao`/upsert-por-chave: cada tratativa é
 * criada com um `id` novo e editada pelo próprio `id`.
 *
 * Escrita via `DATABASE_URL` (service-role), mesmo padrão das demais
 * funções deste arquivo — RLS de `tratativas` hoje só tem policy de
 * SELECT (ver `supabase/migrations/0001_rls.sql`); não há sistema de
 * login no app para vincular a escrita a um usuário autenticado.
 */
export async function criarTratativa(input: NovaTratativaInput): Promise<{ id: string }> {
  const db = getDb();
  const unidadeIdPorCodigo = await garantirUnidades(db, [input.unidade]);
  const unidadeId = unidadeIdPorCodigo.get(input.unidade);
  if (!unidadeId) throw new Error(`Unidade desconhecida: ${input.unidade}`);

  const [linha] = await db
    .insert(tratativas)
    .values({
      unidadeId,
      indicador: input.indicador,
      dataOcorrencia: input.dataOcorrencia,
      problema: input.problema,
      acao: input.acao,
      responsavel: input.responsavel,
      prazo: input.prazo,
      observacao: input.observacao ?? null,
    })
    .returning({ id: tratativas.id });

  return linha;
}

export async function atualizarTratativa(input: AtualizarTratativaInput): Promise<void> {
  const db = getDb();
  const alteracoes: Partial<typeof tratativas.$inferInsert> = { atualizadoEm: sql`now()` as unknown as Date };
  if (input.status !== undefined) alteracoes.status = input.status;
  if (input.responsavel !== undefined) alteracoes.responsavel = input.responsavel;
  if (input.prazo !== undefined) alteracoes.prazo = input.prazo;
  if (input.observacao !== undefined) alteracoes.observacao = input.observacao;

  await db.update(tratativas).set(alteracoes).where(eq(tratativas.id, input.id));
}
