import { and, between, desc, eq, inArray } from "drizzle-orm";
import { UNIDADES, type CodigoUnidade } from "@painel/shared";
import { calcularStatusConferencia, calcularPendente, type StatusConferencia } from "@/lib/rules/conferenciaStatus";
import { semanaRealDoPeriodo } from "@/lib/rules/datas";
import { cicloDaData } from "@/lib/import/periodoAbaQuebra";
import { getDb } from "@/lib/db/client";
import { contarSemMaquininha } from "@/lib/services/pdvEscopo";
import { unidades, fechamentoCaixa, pdvMaquininha, troco, conferencia, quebraCaixa } from "@/lib/db/schema";

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
 * criar regra nova): Fechamento = data exata; PDV × Maquininha = data exata
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
  /**
   * true = a filial pertence à rede mas NÃO tem nenhuma conferência registrada no período (dias vazios). `qtdCadastrados` e
   * `respConferenciaConhecida` vêm do registro mais recente dessa filial no banco (o cadastro de caixas é constante por filial);
   * nenhuma quantidade conferida é inventada.
   */
  semRegistroNoPeriodo?: boolean;
  respConferenciaConhecida?: string | null;
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
    /** Aditivo — resumo de rede e período consultado (ciclo real 16→15, pela data dos registros). */
    totalCaixasRede: number | null;
    totalConferidosRede: number | null;
    totalPendentesRede: number | null;
    periodoInicio: Date | null;
    periodoFim: Date | null;
    /** Aditivo — Σ de "Qtd. caixas" (cadastro) das filiais da rede (equivale ao "TOTAL DE CAIXAS" da planilha); `null` se alguma filial não tem cadastro conhecido. */
    totalCaixasCadastradasRede?: number | null;
    /** Aditivo — filiais da rede sem nenhuma conferência registrada no período. */
    lojasSemRegistro?: CodigoUnidade[];
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
 * Conferência — ciclo real 16→15 que contém `dataReferencia`. Os registros são consultados pela DATA REAL de cada um
 * (`conferencia.data` dentro do ciclo), nunca pela "fonte" de importação: existem várias fontes (uma por nome de arquivo importado)
 * para o mesmo ciclo e a maioria sem registros ligados — escolher uma delas fazia a tela mostrar "sem dados" mesmo com os registros
 * no banco. Cada ciclo mostra só os seus dias (16 a 15 do mês seguinte); os ciclos históricos continuam intactos. Mesma agregação e
 * mesmo status de `buscarConferenciaDoIntervalo` (`calcularStatusConferencia`/`calcularPendente`); "X" (em atraso) continua "X".
 * Sem registros no ciclo: `disponivel:false` — nenhum dado inventado.
 */
export async function buscarConferenciaDoPeriodo(
  db: ReturnType<typeof getDb>,
  dataReferencia: Date
): Promise<ControlesCaixaData["conferencia"]> {
  const ciclo = cicloDaData(dataReferencia);
  const fim = new Date(Date.UTC(ciclo.fim.getUTCFullYear(), ciclo.fim.getUTCMonth(), ciclo.fim.getUTCDate()));
  return buscarConferenciaDoIntervalo(db, ciclo.inicio, fim);
}

/**
 * Conferência por PERÍODO PERSONALIZADO (item 2 da etapa de revisão) —
 * filtra `conferencia.data` diretamente pelo intervalo escolhido (mais o filtro
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

  // Filiais da rede SEM nenhuma conferência no período (sem filtro de loja): aparecem na tela com o cadastro de caixas conhecido
  // (registro mais recente da filial) e dias vazios — nada de quantidade conferida inventada.
  const lojasSemRegistro = unidadeFiltro ? [] : UNIDADES.filter((u) => !porLoja.has(u));
  const semRegistro: ConferenciaLinha[] = [];
  if (lojasSemRegistro.length > 0) {
    const recentes = await db
      .selectDistinctOn([conferencia.unidadeId], {
        codigo: unidades.codigo,
        qtdCadastrados: conferencia.qtdCadastrados,
        respConferencia: conferencia.respConferencia,
      })
      .from(conferencia)
      .innerJoin(unidades, eq(conferencia.unidadeId, unidades.id))
      .where(inArray(unidades.codigo, lojasSemRegistro))
      .orderBy(conferencia.unidadeId, desc(conferencia.data));
    const porCodigo = new Map(recentes.map((r) => [r.codigo, r]));
    for (const u of lojasSemRegistro) {
      const r = porCodigo.get(u);
      semRegistro.push({
        unidade: u,
        ultimaDataConferida: null,
        status: null,
        percentualConferido: null,
        atrasos: 0,
        qtdCadastrados: r ? r.qtdCadastrados : null,
        qtdConferidos: null,
        pendentes: null,
        dias: [],
        semRegistroNoPeriodo: true,
        respConferenciaConhecida: r?.respConferencia ?? null,
      });
    }
  }
  const todasLinhas = [...linhasConf, ...semRegistro];
  const cadastros = todasLinhas.map((l) => l.qtdCadastrados);
  const totalCaixasCadastradasRede = unidadeFiltro || cadastros.some((c) => c === null) ? null : cadastros.reduce<number>((s, c) => s + (c ?? 0), 0);

  return {
    disponivel: linhasConf.length > 0,
    percentualConferidoRede: mediaPercentual,
    totalEmAtraso: linhasConf.reduce((s, l) => s + l.atrasos, 0),
    linhas: todasLinhas,
    totalCaixasRede: linhasConf.reduce((s, l) => s + (l.qtdCadastrados ?? 0), 0),
    totalConferidosRede: linhasConf.reduce((s, l) => s + (l.qtdConferidos ?? 0), 0),
    totalPendentesRede: linhasConf.reduce((s, l) => s + (l.pendentes ?? 0), 0),
    periodoInicio: dataInicio,
    periodoFim: dataFim,
    totalCaixasCadastradasRede,
    lojasSemRegistro,
  };
}

/**
 * Quebra de Caixa — ciclo real 16→15 que contém `dataReferencia`. Os lançamentos são filtrados pela DATA REAL de cada um
 * (`quebra_caixa.data` dentro do ciclo), não pela aba/fonte de origem: um lançamento digitado na aba de outro ciclo continua
 * aparecendo na sua própria data. Sem lançamentos no ciclo, `disponivel:false` — nenhum dado inventado.
 */
export async function buscarQuebraCaixaDoPeriodo(
  db: ReturnType<typeof getDb>,
  dataReferencia: Date
): Promise<ControlesCaixaData["quebraCaixa"]> {
  const vazio: ControlesCaixaData["quebraCaixa"] = { disponivel: false, totalGeral: null, porOperador: [], detalhado: [] };

  const ciclo = cicloDaData(dataReferencia);
  const fontePeriodo = { periodoInicio: ciclo.inicio, periodoFim: new Date(Date.UTC(ciclo.fim.getUTCFullYear(), ciclo.fim.getUTCMonth(), ciclo.fim.getUTCDate())) };

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
    .where(between(quebraCaixa.data, fontePeriodo.periodoInicio, fontePeriodo.periodoFim))
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
 * escolhido pelo usuário. A consulta padrão usa a data exata selecionada.
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

  // --- Fechamento (data exata selecionada, sem D-1) ---
  const d1 = dataReferencia;
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

  // --- PDV × Maquininha (data exata selecionada, sem D-2) ---
  const d2 = dataReferencia;
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

  // --- Conferência (ciclo real 16→15 correspondente à data de referência, pela data real dos registros) ---
  const conferenciaData = await buscarConferenciaDoPeriodo(db, dataReferencia);

  // --- Quebra de Caixa (ciclo real 16→15 correspondente à data de referência, pela data real dos lançamentos) ---
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
