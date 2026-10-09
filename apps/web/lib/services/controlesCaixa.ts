import { and, between, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { CodigoUnidade } from "@painel/shared";
import { calcularStatusConferencia, calcularPendente, type StatusConferencia } from "@/lib/rules/conferenciaStatus";
import { dataDMenos1, dataDMenos2, semanaRealDoPeriodo } from "@/lib/rules/datas";
import { getDb } from "@/lib/db/client";
import { contarSemMaquininha } from "@/lib/services/pdvEscopo";
import { unidades, fechamentoCaixa, pdvMaquininha, troco, conferencia, quebraCaixa, fontesPorPeriodo } from "@/lib/db/schema";

/** Arredonda para 2 casas — evita ruído de ponto flutuante ao somar `numeric` do Postgres (já vem como string). */
function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Camada de serviço da tela Controles de Caixa — espelha as sub-abas
 * reais do painel HTML legado (Controles de Caixa > Fechamento / PDV ×
 * Maquininha / Troco / Conferência / Quebra de Caixa), conforme a
 * auditoria funcional já feita sobre `renderPdvMaquininha` (linha 2668,
 * janela D-2), `renderTroco` (linha 3537, semana mais recente),
 * `renderConferenciaMatrix`/`renderConferenciaTab` (linhas 3330/3424) e
 * `renderQuebraCaixa` (linha 5336).
 *
 * IMPORTANTE — achado da auditoria: o legado NÃO TEM uma função de
 * render dedicada para "Fechamento"; a sub-aba "Fechamento" abaixo usa
 * D-1 (mesma janela do card resumo da Visão Geral) e as colunas reais
 * do schema/parser já validado.
 *
 * Janelas de data por bloco (reaproveitando `lib/rules/datas.ts`, sem
 * criar regra nova): Fechamento = D-1; PDV × Maquininha = D-2
 * (confirmado no legado); Troco = semana mais recente com dado
 * (`semanaRealDoPeriodo` aplicada sobre a data máxima da tabela);
 * Conferência = status da última linha por loja dentro dessa mesma
 * semana, calculado via `calcularStatusConferencia` (já validada e
 * testada, não reimplementada). Quebra de Caixa: ainda não persistida
 * nesta etapa — permanece `disponivel: false`, sem dado inventado.
 *
 * Sem DATABASE_URL: todos os campos vêm como listas vazias /
 * `disponivel: false` — nenhum dado é inventado.
 */

export interface FechamentoLinha {
  unidade: CodigoUnidade;
  caixa: string;
  movimento: string;
  abertura: string | null;
  fechamento: string | null;
  operador: string | null;
  situacao: string | null;
  difFechamento: number | null;
  difConciliacao: number | null;
  difTotal: number | null;
}

export interface PdvMaquininhaLinha {
  unidade: CodigoUnidade;
  totalPdv: number;
  totalMaquininha: number;
  diferenca: number;
}

export interface TrocoCaixaLinha {
  caixa: string;
  data: Date;
  conferido: number;
  informado: number;
  diferenca: number;
  status: "Conferido" | "Divergência" | "Conferência não realizada";
  operador: string | null;
  planoDeAcao: string | null;
}

export interface TrocoLinha {
  unidade: CodigoUnidade;
  caixas: TrocoCaixaLinha[];
}

export interface ConferenciaDiaLinha {
  data: Date;
  qtdCadastrados: number;
  qtdConferidos: number | null;
  emAtraso: boolean;
  respConferencia: string | null;
  status: StatusConferencia | null;
}

export interface ConferenciaLinha {
  unidade: CodigoUnidade;
  ultimaDataConferida: Date | null;
  status: StatusConferencia | null;
  percentualConferido: number | null;
  atrasos: number;
  /** Aditivo — snapshot do último dia com lançamento (mesma linha usada para `status`/`percentualConferido`). */
  qtdCadastrados: number | null;
  qtdConferidos: number | null;
  pendentes: number | null;
  /** Aditivo — todas as linhas (dia a dia) da unidade dentro do período resolvido, para a expansão da tela. */
  dias: ConferenciaDiaLinha[];
}

export interface QuebraOperadorLinha {
  operador: string;
  cpf: string;
  quantidade: number;
  valorTotal: number;
}

export interface QuebraDetalheLinha {
  data: Date;
  unidade: CodigoUnidade;
  valor: number;
  motivo: string;
  operador: string;
  conferente: string;
  cpf: string;
}

export interface ControlesCaixaData {
  conectado: boolean;
  dataReferencia: Date;

  fechamento: { disponivel: boolean; caixasEmAberto: number | null; linhas: FechamentoLinha[] };
  pdvMaquininha: {
    disponivel: boolean;
    totalPdvRede: number | null;
    totalMaquininhaRede: number | null;
    diferencaRede: number | null;
    linhas: PdvMaquininhaLinha[];
    /** Linhas (loja+dia+forma) com Maquininha = 0 e PDV > 0 — candidatas a "célula em branco na origem lida como 0" (só informativo). */
    semMaquininha?: { linhas: number; pdv: number };
  };
  troco: {
    disponivel: boolean;
    totalConferido: number | null;
    totalInformado: number | null;
    diferencaTotal: number | null;
    divergencias: number | null;
    linhas: TrocoLinha[];
  };
  conferencia: {
    disponivel: boolean;
    percentualConferidoRede: number | null;
    totalEmAtraso: number | null;
    linhas: ConferenciaLinha[];
    /** Aditivo — resumo de rede e período resolvido (`fontesPorPeriodo`, ciclo real 16→15). */
    totalCaixasRede: number | null;
    totalConferidosRede: number | null;
    totalPendentesRede: number | null;
    periodoInicio: Date | null;
    periodoFim: Date | null;
  };
  quebraCaixa: {
    disponivel: boolean;
    totalGeral: number | null;
    porOperador: QuebraOperadorLinha[];
    detalhado: QuebraDetalheLinha[];
    /** Janela efetiva do período (ciclo 16→15 resolvido ou intervalo escolhido) — metadado para a análise por loja. */
    periodoInicio?: Date | null;
    periodoFim?: Date | null;
  };
}

function baseIndisponivel(dataReferencia: Date, conectado: boolean): ControlesCaixaData {
  return {
    conectado,
    dataReferencia,
    fechamento: { disponivel: false, caixasEmAberto: null, linhas: [] },
    pdvMaquininha: { disponivel: false, totalPdvRede: null, totalMaquininhaRede: null, diferencaRede: null, linhas: [] },
    troco: { disponivel: false, totalConferido: null, totalInformado: null, diferencaTotal: null, divergencias: null, linhas: [] },
    conferencia: {
      disponivel: false,
      percentualConferidoRede: null,
      totalEmAtraso: null,
      linhas: [],
      totalCaixasRede: null,
      totalConferidosRede: null,
      totalPendentesRede: null,
      periodoInicio: null,
      periodoFim: null,
    },
    quebraCaixa: { disponivel: false, totalGeral: null, porOperador: [], detalhado: [] },
  };
}

/**
 * Troco — semana real (`semanaRealDoPeriodo`, já validada/testada) que
 * contém `dataReferencia`. Extraída como função própria para ser
 * reaproveitada tanto pelo card resumo de Controles de Caixa (semana da
 * data mais recente com dado) quanto pelo filtro de período dedicado da
 * aba Troco — mesma regra em ambos os lugares, nunca duplicada.
 */
export async function buscarTrocoDaSemana(
  db: ReturnType<typeof getDb>,
  dataReferencia: Date
): Promise<ControlesCaixaData["troco"]> {
  const vazio: ControlesCaixaData["troco"] = {
    disponivel: false,
    totalConferido: null,
    totalInformado: null,
    diferencaTotal: null,
    divergencias: null,
    linhas: [],
  };

  const { inicio, fim } = semanaRealDoPeriodo(dataReferencia);
  const trocoRows = await db
    .select({
      codigo: unidades.codigo,
      caixa: troco.caixa,
      data: troco.data,
      conferido: troco.trocoConferidoGerente,
      informado: troco.trocoInformadoColaborador,
      diferenca: troco.diferenca,
      operador: troco.operador,
      planoDeAcao: troco.planoDeAcao,
    })
    .from(troco)
    .innerJoin(unidades, eq(troco.unidadeId, unidades.id))
    .where(between(troco.data, inicio, fim));

  if (trocoRows.length === 0) return vazio;

  const porLoja = new Map<string, TrocoCaixaLinha[]>();
  for (const r of trocoRows) {
    const diferenca = Number(r.diferenca);
    const status: TrocoCaixaLinha["status"] = diferenca === 0 ? "Conferido" : "Divergência";
    const linha: TrocoCaixaLinha = {
      caixa: r.caixa,
      data: r.data,
      conferido: Number(r.conferido),
      informado: Number(r.informado),
      diferenca,
      status,
      operador: r.operador,
      planoDeAcao: r.planoDeAcao,
    };
    const lista = porLoja.get(r.codigo) ?? [];
    lista.push(linha);
    porLoja.set(r.codigo, lista);
  }

  const linhasTroco: TrocoLinha[] = [...porLoja.entries()].map(([codigo, caixas]) => ({
    unidade: codigo as CodigoUnidade,
    caixas,
  }));
  const todasCaixas = linhasTroco.flatMap((l) => l.caixas);

  return {
    disponivel: todasCaixas.length > 0,
    totalConferido: arred(todasCaixas.reduce((s, c) => s + c.conferido, 0)),
    totalInformado: arred(todasCaixas.reduce((s, c) => s + c.informado, 0)),
    diferencaTotal: arred(todasCaixas.reduce((s, c) => s + c.diferenca, 0)),
    divergencias: todasCaixas.filter((c) => c.status === "Divergência").length,
    linhas: linhasTroco,
  };
}

/**
 * Troco por PERÍODO (item 2 da etapa de revisão). Regra "semana
 * correspondente" preservada: os dois extremos escolhidos pela usuária
 * são expandidos para a semana real (`semanaRealDoPeriodo`, mesma função
 * já validada) que os contém, e a consulta cobre da segunda-feira da
 * primeira semana ao domingo da última — nunca uma janela arbitrária.
 * Mesma agregação de `buscarTrocoDaSemana`, só troca a origem do
 * intervalo e aceita um filtro de loja opcional.
 */
export async function buscarTrocoDoIntervalo(
  db: ReturnType<typeof getDb>,
  dataInicio: Date,
  dataFim: Date,
  unidadeFiltro?: CodigoUnidade
): Promise<ControlesCaixaData["troco"]> {
  const vazio: ControlesCaixaData["troco"] = {
    disponivel: false,
    totalConferido: null,
    totalInformado: null,
    diferencaTotal: null,
    divergencias: null,
    linhas: [],
  };

  const inicio = semanaRealDoPeriodo(dataInicio).inicio;
  const fim = semanaRealDoPeriodo(dataFim).fim;

  let unidadeId: string | undefined;
  if (unidadeFiltro) {
    const [linha] = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.codigo, unidadeFiltro));
    unidadeId = linha?.id;
    if (!unidadeId) return vazio;
  }

  const trocoRows = await db
    .select({
      codigo: unidades.codigo,
      caixa: troco.caixa,
      data: troco.data,
      conferido: troco.trocoConferidoGerente,
      informado: troco.trocoInformadoColaborador,
      diferenca: troco.diferenca,
      operador: troco.operador,
      planoDeAcao: troco.planoDeAcao,
    })
    .from(troco)
    .innerJoin(unidades, eq(troco.unidadeId, unidades.id))
    .where(unidadeId ? and(between(troco.data, inicio, fim), eq(troco.unidadeId, unidadeId)) : between(troco.data, inicio, fim));

  if (trocoRows.length === 0) return vazio;

  const porLoja = new Map<string, TrocoCaixaLinha[]>();
  for (const r of trocoRows) {
    const diferenca = Number(r.diferenca);
    const status: TrocoCaixaLinha["status"] = diferenca === 0 ? "Conferido" : "Divergência";
    const linha: TrocoCaixaLinha = {
      caixa: r.caixa,
      data: r.data,
      conferido: Number(r.conferido),
      informado: Number(r.informado),
      diferenca,
      status,
      operador: r.operador,
      planoDeAcao: r.planoDeAcao,
    };
    const lista = porLoja.get(r.codigo) ?? [];
    lista.push(linha);
    porLoja.set(r.codigo, lista);
  }

  const linhasTroco: TrocoLinha[] = [...porLoja.entries()].map(([codigo, caixas]) => ({
    unidade: codigo as CodigoUnidade,
    caixas,
  }));
  const todasCaixas = linhasTroco.flatMap((l) => l.caixas);

  return {
    disponivel: todasCaixas.length > 0,
    totalConferido: arred(todasCaixas.reduce((s, c) => s + c.conferido, 0)),
    totalInformado: arred(todasCaixas.reduce((s, c) => s + c.informado, 0)),
    diferencaTotal: arred(todasCaixas.reduce((s, c) => s + c.diferenca, 0)),
    divergencias: todasCaixas.filter((c) => c.status === "Divergência").length,
    linhas: linhasTroco,
  };
}

/**
 * Conferência — resolve o PERÍODO (ciclo real 16→15) que contém
 * `dataReferencia` a partir de `fontesPorPeriodo` (tipoBase='conferencia'),
 * já gravado no import (mesmo conceito de `resolverAbaConferenciaPorData`
 * — aqui aplicado sobre o período já persistido, não reprocessando o
 * Excel). Sem esse período coberto, retorna `disponivel:false` — nenhum
 * dado inventado.
 *
 * Por loja: "Total"/"Conferidos"/status usam o snapshot do ÚLTIMO dia
 * com lançamento no período (mesma semântica já validada antes desta
 * etapa, que usava a semana mais recente — aqui só passou a olhar o
 * período/ciclo real inteiro em vez de uma semana). "Pendentes" usa
 * `calcularPendente` (já existia em conferenciaStatus.ts, nunca estava
 * ligada a nenhuma tela). "Atrasados" continua sendo a contagem de dias
 * com `em_atraso=true` dentro do período. Nenhum threshold/limiar novo
 * foi criado — status por dia e por loja usa exatamente
 * `calcularStatusConferencia`.
 */
export async function buscarConferenciaDoPeriodo(
  db: ReturnType<typeof getDb>,
  dataReferencia: Date
): Promise<ControlesCaixaData["conferencia"]> {
  const vazio: ControlesCaixaData["conferencia"] = {
    disponivel: false,
    percentualConferidoRede: null,
    totalEmAtraso: null,
    linhas: [],
    totalCaixasRede: null,
    totalConferidosRede: null,
    totalPendentesRede: null,
    periodoInicio: null,
    periodoFim: null,
  };

  const [fontePeriodo] = await db
    .select({ id: fontesPorPeriodo.id, periodoInicio: fontesPorPeriodo.periodoInicio, periodoFim: fontesPorPeriodo.periodoFim })
    .from(fontesPorPeriodo)
    .where(
      and(
        eq(fontesPorPeriodo.tipoBase, "conferencia"),
        lte(fontesPorPeriodo.periodoInicio, dataReferencia),
        gte(fontesPorPeriodo.periodoFim, dataReferencia)
      )
    )
    .orderBy(desc(fontesPorPeriodo.periodoFim))
    .limit(1);

  if (!fontePeriodo) return vazio;

  const confRows = await db
    .select({
      codigo: unidades.codigo,
      data: conferencia.data,
      qtdCadastrados: conferencia.qtdCadastrados,
      qtdConferidos: conferencia.qtdConferidos,
      emAtraso: conferencia.emAtraso,
      respConferencia: conferencia.respConferencia,
    })
    .from(conferencia)
    .innerJoin(unidades, eq(conferencia.unidadeId, unidades.id))
    .where(eq(conferencia.fontePeriodoId, fontePeriodo.id))
    .orderBy(desc(conferencia.data));

  if (confRows.length === 0) return vazio;

  const porLoja = new Map<string, (typeof confRows)[number][]>();
  for (const r of confRows) {
    const lista = porLoja.get(r.codigo) ?? [];
    lista.push(r);
    porLoja.set(r.codigo, lista);
  }

  const linhasConf: ConferenciaLinha[] = [...porLoja.entries()].map(([codigo, rows]) => {
    const dias: ConferenciaDiaLinha[] = rows.map((r) => ({
      data: r.data,
      qtdCadastrados: r.qtdCadastrados,
      qtdConferidos: r.qtdConferidos,
      emAtraso: r.emAtraso,
      respConferencia: r.respConferencia,
      status: calcularStatusConferencia({
        total: r.qtdCadastrados,
        conferido: r.qtdConferidos ?? 0,
        emAtrasoPelaRegraGlobal: r.emAtraso,
        unidadeSemConferenciaNoFimDeSemana: false,
        dataEhFimDeSemana: false,
      }),
    }));

    const ultima = rows[0]; // já ordenado desc por data
    const status = dias[0].status;
    const pendentes = calcularPendente(ultima.qtdCadastrados, ultima.qtdConferidos ?? 0);

    return {
      unidade: codigo as CodigoUnidade,
      ultimaDataConferida: ultima.data,
      status,
      percentualConferido: ultima.qtdCadastrados > 0 ? ((ultima.qtdConferidos ?? 0) / ultima.qtdCadastrados) * 100 : null,
      atrasos: rows.filter((r) => r.emAtraso).length,
      qtdCadastrados: ultima.qtdCadastrados,
      qtdConferidos: ultima.qtdConferidos,
      pendentes,
      dias,
    };
  });

  const mediaPercentual =
    linhasConf.length > 0
      ? linhasConf.reduce((s, l) => s + (l.percentualConferido ?? 0), 0) / linhasConf.length
      : null;

  return {
    disponivel: linhasConf.length > 0,
    percentualConferidoRede: mediaPercentual,
    totalEmAtraso: linhasConf.reduce((s, l) => s + l.atrasos, 0),
    linhas: linhasConf,
    totalCaixasRede: linhasConf.reduce((s, l) => s + (l.qtdCadastrados ?? 0), 0),
    totalConferidosRede: linhasConf.reduce((s, l) => s + (l.qtdConferidos ?? 0), 0),
    totalPendentesRede: linhasConf.reduce((s, l) => s + (l.pendentes ?? 0), 0),
    periodoInicio: new Date(fontePeriodo.periodoInicio),
    periodoFim: new Date(fontePeriodo.periodoFim),
  };
}

/**
 * Conferência por PERÍODO PERSONALIZADO (item 2 da etapa de revisão) —
 * bypassa a resolução de um único ciclo via `fontesPorPeriodo` e filtra
 * `conferencia.data` diretamente pelo intervalo escolhido (mais o filtro
 * de loja opcional). Mesma agregação/status de `buscarConferenciaDoPeriodo`
 * (`calcularStatusConferencia`/`calcularPendente`, já validadas) —
 * nenhuma regra nova, só a origem do intervalo de datas.
 */
export async function buscarConferenciaDoIntervalo(
  db: ReturnType<typeof getDb>,
  dataInicio: Date,
  dataFim: Date,
  unidadeFiltro?: CodigoUnidade
): Promise<ControlesCaixaData["conferencia"]> {
  const vazio: ControlesCaixaData["conferencia"] = {
    disponivel: false,
    percentualConferidoRede: null,
    totalEmAtraso: null,
    linhas: [],
    totalCaixasRede: null,
    totalConferidosRede: null,
    totalPendentesRede: null,
    periodoInicio: dataInicio,
    periodoFim: dataFim,
  };

  let unidadeId: string | undefined;
  if (unidadeFiltro) {
    const [linha] = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.codigo, unidadeFiltro));
    unidadeId = linha?.id;
    if (!unidadeId) return vazio;
  }

  const confRows = await db
    .select({
      codigo: unidades.codigo,
      data: conferencia.data,
      qtdCadastrados: conferencia.qtdCadastrados,
      qtdConferidos: conferencia.qtdConferidos,
      emAtraso: conferencia.emAtraso,
      respConferencia: conferencia.respConferencia,
    })
    .from(conferencia)
    .innerJoin(unidades, eq(conferencia.unidadeId, unidades.id))
    .where(
      unidadeId
        ? and(between(conferencia.data, dataInicio, dataFim), eq(conferencia.unidadeId, unidadeId))
        : between(conferencia.data, dataInicio, dataFim)
    )
    .orderBy(desc(conferencia.data));

  if (confRows.length === 0) return vazio;

  const porLoja = new Map<string, (typeof confRows)[number][]>();
  for (const r of confRows) {
    const lista = porLoja.get(r.codigo) ?? [];
    lista.push(r);
    porLoja.set(r.codigo, lista);
  }

  const linhasConf: ConferenciaLinha[] = [...porLoja.entries()].map(([codigo, rows]) => {
    const dias: ConferenciaDiaLinha[] = rows.map((r) => ({
      data: r.data,
      qtdCadastrados: r.qtdCadastrados,
      qtdConferidos: r.qtdConferidos,
      emAtraso: r.emAtraso,
      respConferencia: r.respConferencia,
      status: calcularStatusConferencia({
        total: r.qtdCadastrados,
        conferido: r.qtdConferidos ?? 0,
        emAtrasoPelaRegraGlobal: r.emAtraso,
        unidadeSemConferenciaNoFimDeSemana: false,
        dataEhFimDeSemana: false,
      }),
    }));

    const ultima = rows[0]; // já ordenado desc por data
    const status = dias[0].status;
    const pendentes = calcularPendente(ultima.qtdCadastrados, ultima.qtdConferidos ?? 0);

    return {
      unidade: codigo as CodigoUnidade,
      ultimaDataConferida: ultima.data,
      status,
      percentualConferido: ultima.qtdCadastrados > 0 ? ((ultima.qtdConferidos ?? 0) / ultima.qtdCadastrados) * 100 : null,
      atrasos: rows.filter((r) => r.emAtraso).length,
      qtdCadastrados: ultima.qtdCadastrados,
      qtdConferidos: ultima.qtdConferidos,
      pendentes,
      dias,
    };
  });

  const mediaPercentual =
    linhasConf.length > 0 ? linhasConf.reduce((s, l) => s + (l.percentualConferido ?? 0), 0) / linhasConf.length : null;

  return {
    disponivel: linhasConf.length > 0,
    percentualConferidoRede: mediaPercentual,
    totalEmAtraso: linhasConf.reduce((s, l) => s + l.atrasos, 0),
    linhas: linhasConf,
    totalCaixasRede: linhasConf.reduce((s, l) => s + (l.qtdCadastrados ?? 0), 0),
    totalConferidosRede: linhasConf.reduce((s, l) => s + (l.qtdConferidos ?? 0), 0),
    totalPendentesRede: linhasConf.reduce((s, l) => s + (l.pendentes ?? 0), 0),
    periodoInicio: dataInicio,
    periodoFim: dataFim,
  };
}

/**
 * Quebra de Caixa — mesmo mecanismo de `buscarConferenciaDoPeriodo`:
 * resolve o período (ciclo real 16→15) que contém `dataReferencia` via
 * `fontesPorPeriodo` (tipoBase='quebra_caixa'). Sem período coberto,
 * `disponivel:false` — nenhum dado inventado.
 */
export async function buscarQuebraCaixaDoPeriodo(
  db: ReturnType<typeof getDb>,
  dataReferencia: Date
): Promise<ControlesCaixaData["quebraCaixa"]> {
  const vazio: ControlesCaixaData["quebraCaixa"] = { disponivel: false, totalGeral: null, porOperador: [], detalhado: [] };

  const [fontePeriodo] = await db
    .select({ id: fontesPorPeriodo.id, periodoInicio: fontesPorPeriodo.periodoInicio, periodoFim: fontesPorPeriodo.periodoFim })
    .from(fontesPorPeriodo)
    .where(
      and(
        eq(fontesPorPeriodo.tipoBase, "quebra_caixa"),
        lte(fontesPorPeriodo.periodoInicio, dataReferencia),
        gte(fontesPorPeriodo.periodoFim, dataReferencia)
      )
    )
    .orderBy(desc(fontesPorPeriodo.periodoFim))
    .limit(1);

  if (!fontePeriodo) return vazio;

  const quebraRows = await db
    .select({
      codigo: unidades.codigo,
      data: quebraCaixa.data,
      valor: quebraCaixa.valor,
      conferente: quebraCaixa.conferente,
      operador: quebraCaixa.operador,
      cpf: quebraCaixa.cpf,
      motivo: quebraCaixa.motivo,
    })
    .from(quebraCaixa)
    .innerJoin(unidades, eq(quebraCaixa.unidadeId, unidades.id))
    .where(eq(quebraCaixa.fontePeriodoId, fontePeriodo.id))
    .orderBy(desc(quebraCaixa.data));

  if (quebraRows.length === 0) return vazio;

  const detalhado: QuebraDetalheLinha[] = quebraRows.map((r) => ({
    data: r.data,
    unidade: r.codigo as CodigoUnidade,
    valor: Number(r.valor),
    motivo: r.motivo,
    operador: r.operador,
    conferente: r.conferente,
    cpf: r.cpf,
  }));

  const porOperadorMapa = new Map<string, QuebraOperadorLinha>();
  for (const r of quebraRows) {
    const chave = `${r.cpf}||${r.operador}`;
    const atual = porOperadorMapa.get(chave) ?? { operador: r.operador, cpf: r.cpf, quantidade: 0, valorTotal: 0 };
    atual.quantidade += 1;
    atual.valorTotal = arred(atual.valorTotal + Number(r.valor));
    porOperadorMapa.set(chave, atual);
  }
  const porOperador = [...porOperadorMapa.values()].sort((a, b) => b.valorTotal - a.valorTotal);

  return {
    disponivel: true,
    totalGeral: arred(detalhado.reduce((s, l) => s + l.valor, 0)),
    porOperador,
    detalhado,
    periodoInicio: fontePeriodo.periodoInicio,
    periodoFim: fontePeriodo.periodoFim,
  };
}

/**
 * Quebra de Caixa — período PERSONALIZADO (filtro adicional, item 8 da
 * etapa de revisão). Mesma agregação de `buscarQuebraCaixaDoPeriodo`
 * (soma/agrupamento por operador idênticos), só troca a resolução do
 * período: em vez de localizar o ciclo 16→15 em `fontesPorPeriodo`, filtra
 * `quebraCaixa.data` diretamente pelo intervalo [inicio, fim] escolhido
 * pelo usuário. Nenhuma regra de cálculo foi alterada.
 */
export async function buscarQuebraCaixaDoIntervalo(
  db: ReturnType<typeof getDb>,
  inicio: Date,
  fim: Date,
  unidadeFiltro?: CodigoUnidade
): Promise<ControlesCaixaData["quebraCaixa"]> {
  const vazio: ControlesCaixaData["quebraCaixa"] = { disponivel: false, totalGeral: null, porOperador: [], detalhado: [] };

  let unidadeId: string | undefined;
  if (unidadeFiltro) {
    const [linha] = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.codigo, unidadeFiltro));
    unidadeId = linha?.id;
    if (!unidadeId) return vazio;
  }

  const quebraRows = await db
    .select({
      codigo: unidades.codigo,
      data: quebraCaixa.data,
      valor: quebraCaixa.valor,
      conferente: quebraCaixa.conferente,
      operador: quebraCaixa.operador,
      cpf: quebraCaixa.cpf,
      motivo: quebraCaixa.motivo,
    })
    .from(quebraCaixa)
    .innerJoin(unidades, eq(quebraCaixa.unidadeId, unidades.id))
    .where(unidadeId ? and(between(quebraCaixa.data, inicio, fim), eq(quebraCaixa.unidadeId, unidadeId)) : between(quebraCaixa.data, inicio, fim))
    .orderBy(desc(quebraCaixa.data));

  if (quebraRows.length === 0) return vazio;

  const detalhado: QuebraDetalheLinha[] = quebraRows.map((r) => ({
    data: r.data,
    unidade: r.codigo as CodigoUnidade,
    valor: Number(r.valor),
    motivo: r.motivo,
    operador: r.operador,
    conferente: r.conferente,
    cpf: r.cpf,
  }));

  const porOperadorMapa = new Map<string, QuebraOperadorLinha>();
  for (const r of quebraRows) {
    const chave = `${r.cpf}||${r.operador}`;
    const atual = porOperadorMapa.get(chave) ?? { operador: r.operador, cpf: r.cpf, quantidade: 0, valorTotal: 0 };
    atual.quantidade += 1;
    atual.valorTotal = arred(atual.valorTotal + Number(r.valor));
    porOperadorMapa.set(chave, atual);
  }
  const porOperador = [...porOperadorMapa.values()].sort((a, b) => b.valorTotal - a.valorTotal);

  return {
    disponivel: true,
    totalGeral: arred(detalhado.reduce((s, l) => s + l.valor, 0)),
    porOperador,
    detalhado,
    periodoInicio: inicio,
    periodoFim: fim,
  };
}

/**
 * PDV × Maquininha — período PERSONALIZADO (filtro adicional, item 6 da
 * etapa de revisão). Mesma agregação/classificação de
 * `buscarControlesCaixa` (soma por loja, `diferenca = maquininha - pdv`),
 * só troca `eq(pdvMaquininha.data, d2)` pelo intervalo [inicio, fim]
 * escolhido pelo usuário. A consulta padrão (D-2) continua inalterada.
 *
 * `formas` (opcional): restringe às formas de pagamento informadas (a aba PDV × Maquininha usa só as 4 da extração do
 * Power BI). Sem `formas` o comportamento é o de sempre (todas as formas). As datas chegam como o chamador as define:
 * esta função não aplica deslocamento nenhum.
 */
export async function buscarPdvMaquininhaIntervalo(
  db: ReturnType<typeof getDb>,
  inicio: Date,
  fim: Date,
  unidadeFiltro?: CodigoUnidade,
  formas?: readonly string[]
): Promise<ControlesCaixaData["pdvMaquininha"]> {
  const vazio: ControlesCaixaData["pdvMaquininha"] = { disponivel: false, totalPdvRede: null, totalMaquininhaRede: null, diferencaRede: null, linhas: [] };

  let unidadeId: string | undefined;
  if (unidadeFiltro) {
    const [linha] = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.codigo, unidadeFiltro));
    unidadeId = linha?.id;
    if (!unidadeId) return vazio;
  }

  const pdvRows = await db
    .select({ codigo: unidades.codigo, valorPdv: pdvMaquininha.valorPdv, valorMaquininha: pdvMaquininha.valorMaquininha })
    .from(pdvMaquininha)
    .innerJoin(unidades, eq(pdvMaquininha.unidadeId, unidades.id))
    .where(
      and(
        between(pdvMaquininha.data, inicio, fim),
        unidadeId ? eq(pdvMaquininha.unidadeId, unidadeId) : undefined,
        formas && formas.length > 0 ? inArray(pdvMaquininha.formaPagamento, [...formas]) : undefined
      )
    );

  const pdvPorLoja = new Map<string, { pdv: number; maq: number }>();
  for (const r of pdvRows) {
    const atual = pdvPorLoja.get(r.codigo) ?? { pdv: 0, maq: 0 };
    atual.pdv += Number(r.valorPdv);
    atual.maq += Number(r.valorMaquininha);
    pdvPorLoja.set(r.codigo, atual);
  }
  const pdvLinhas: PdvMaquininhaLinha[] = [...pdvPorLoja.entries()].map(([codigo, v]) => ({
    unidade: codigo as CodigoUnidade,
    totalPdv: arred(v.pdv),
    totalMaquininha: arred(v.maq),
    diferenca: arred(v.maq - v.pdv),
  }));
  const totalPdvRede = arred(pdvLinhas.reduce((s, l) => s + l.totalPdv, 0));
  const totalMaquininhaRede = arred(pdvLinhas.reduce((s, l) => s + l.totalMaquininha, 0));

  return {
    disponivel: pdvLinhas.length > 0,
    totalPdvRede: pdvLinhas.length > 0 ? totalPdvRede : null,
    totalMaquininhaRede: pdvLinhas.length > 0 ? totalMaquininhaRede : null,
    diferencaRede: pdvLinhas.length > 0 ? arred(totalMaquininhaRede - totalPdvRede) : null,
    linhas: pdvLinhas,
    semMaquininha: contarSemMaquininha(pdvRows),
  };
}

export async function buscarControlesCaixa(dataReferencia: Date): Promise<ControlesCaixaData> {
  const conectado = Boolean(process.env.DATABASE_URL);
  const base = baseIndisponivel(dataReferencia, conectado);
  if (!conectado) return base;

  const db = getDb();

  // --- Fechamento (D-1) ---
  const d1 = dataDMenos1(dataReferencia);
  const fechRows = await db
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
    .where(eq(fechamentoCaixa.data, d1));

  const fechamentoData: ControlesCaixaData["fechamento"] = {
    disponivel: fechRows.length > 0,
    caixasEmAberto: fechRows.filter((r) => r.situacao === "Aberto").length,
    linhas: fechRows.map((r) => ({
      unidade: r.codigo as CodigoUnidade,
      caixa: r.caixa,
      movimento: r.movimento,
      abertura: r.abertura,
      fechamento: r.fechamento,
      operador: r.operador,
      situacao: r.situacao,
      difFechamento: r.difFechamento ? Number(r.difFechamento) : null,
      difConciliacao: r.difConciliacao ? Number(r.difConciliacao) : null,
      difTotal: r.difTotal ? Number(r.difTotal) : null,
    })),
  };

  // --- PDV × Maquininha (D-2, confirmado no legado) ---
  const d2 = dataDMenos2(dataReferencia);
  const pdvRows = await db
    .select({
      codigo: unidades.codigo,
      valorPdv: pdvMaquininha.valorPdv,
      valorMaquininha: pdvMaquininha.valorMaquininha,
    })
    .from(pdvMaquininha)
    .innerJoin(unidades, eq(pdvMaquininha.unidadeId, unidades.id))
    .where(eq(pdvMaquininha.data, d2));

  const pdvPorLoja = new Map<string, { pdv: number; maq: number }>();
  for (const r of pdvRows) {
    const atual = pdvPorLoja.get(r.codigo) ?? { pdv: 0, maq: 0 };
    atual.pdv += Number(r.valorPdv);
    atual.maq += Number(r.valorMaquininha);
    pdvPorLoja.set(r.codigo, atual);
  }
  const pdvLinhas: PdvMaquininhaLinha[] = [...pdvPorLoja.entries()].map(([codigo, v]) => ({
    unidade: codigo as CodigoUnidade,
    totalPdv: arred(v.pdv),
    totalMaquininha: arred(v.maq),
    diferenca: arred(v.maq - v.pdv),
  }));
  const totalPdvRede = arred(pdvLinhas.reduce((s, l) => s + l.totalPdv, 0));
  const totalMaquininhaRede = arred(pdvLinhas.reduce((s, l) => s + l.totalMaquininha, 0));

  const pdvData: ControlesCaixaData["pdvMaquininha"] = {
    disponivel: pdvLinhas.length > 0,
    totalPdvRede: pdvLinhas.length > 0 ? totalPdvRede : null,
    totalMaquininhaRede: pdvLinhas.length > 0 ? totalMaquininhaRede : null,
    diferencaRede: pdvLinhas.length > 0 ? arred(totalMaquininhaRede - totalPdvRede) : null,
    linhas: pdvLinhas,
  };

  // --- Troco (semana correspondente à data de referência, `semanaRealDoPeriodo` já validada) ---
  const trocoData = await buscarTrocoDaSemana(db, dataReferencia);

  // --- Conferência (ciclo real 16→15 correspondente à data de referência, via fontesPorPeriodo) ---
  const conferenciaData = await buscarConferenciaDoPeriodo(db, dataReferencia);

  // --- Quebra de Caixa (ciclo real 16→15 correspondente à data de referência, via fontesPorPeriodo) ---
  const quebraCaixaData = await buscarQuebraCaixaDoPeriodo(db, dataReferencia);

  return {
    conectado,
    dataReferencia,
    fechamento: fechamentoData,
    pdvMaquininha: pdvData,
    troco: trocoData,
    conferencia: conferenciaData,
    quebraCaixa: quebraCaixaData,
  };
}
