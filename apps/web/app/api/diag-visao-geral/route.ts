import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import postgres from "postgres";
import { and, between, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { faturamento } from "@/lib/db/schema";
import { mesAnteriorCompleto } from "@/lib/rules/mesAnterior";
import { buscarVisaoGeralPeriodo } from "@/lib/services/visaoGeral";
import { buscarDesempenhoCaixa } from "@/lib/services/desempenhoCaixa.server";

/**
 * ROTA TEMPORÁRIA DE DIAGNÓSTICO — remover depois do uso (apagar este arquivo).
 *
 * Em produção o Next mascara a mensagem de erro de Server Components/Actions (só mostra um digest). Esta rota executa
 * cada operação da Visão Geral SEPARADAMENTE (mesmas funções, mesmo `getDb()` e mesmo pool de produção), com timeout
 * individual, e devolve ok/tempo/erro legíveis em JSON.
 *
 * Somente leitura (apenas `select`). Não devolve DATABASE_URL, usuário nem senha: do ambiente só sai host:porta, e toda
 * mensagem de erro passa por `limpar()`. Também não devolve dados de negócio (só tempos, status e contagens).
 *
 * PROTEÇÃO: o domínio de produção é público e o repositório também, então o acesso exige o segredo `DIAG_TOKEN`, lido
 * SOMENTE de `process.env.DIAG_TOKEN` (cadastrado na Vercel; nunca no código). Sem a variável → 404 (a rota "não
 * existe"); com a variável, só responde se a requisição trouxer o mesmo valor em `x-diag-token` (preferível) ou
 * `?token=`; qualquer outro caso → 404. O token nunca é devolvido nem registrado em log.
 *
 * Uso: /api/diag-visao-geral?inicio=2026-09-01&fim=2026-09-30   (header x-diag-token: <valor>)
 * Opcional: &so=ambiente|ping|contagem|etapas|real|pipeline|visao|desempenho|ssr   (sem `so`: tudo, exceto `visao`, `real` e `pipeline`)
 *   etapas → as consultas internas de `buscarVisaoGeralPeriodo` em paralelo, cada uma com cliente próprio e timeout de 5 s
             (acrescente &seq=1 para rodar uma de cada vez)
 *   pipeline → prova de hipótese: N consultas simples em paralelo com a configuração atual do postgres-js × com
 *             `max_pipeline: 1` (&n=34 &reps=2). Somente `select count(*)`; não toca no pool compartilhado.
 *   real   → a própria `buscarVisaoGeralPeriodo` + fotografias de `pg_stat_activity` aos 4 s, 9 s e 13 s (mostra qual
             consulta está pendente e em que espera)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIMEOUT_ETAPA_MS = 15_000;
const ORCAMENTO_TOTAL_MS = 50_000;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const dataDoInput = (v: string) => new Date(`${v}T00:00:00.000Z`);

/** Remove qualquer trecho que lembre credencial/URL de conexão. */
function limpar(texto: string): string {
  let t = texto;
  const token = process.env.DIAG_TOKEN;
  if (token && token.length >= 3) t = t.split(token).join("[oculto]");
  const url = process.env.DATABASE_URL;
  if (url) {
    t = t.split(url).join("[DATABASE_URL]");
    try {
      const u = new URL(url);
      for (const segredo of [decodeURIComponent(u.password), u.password, u.username, decodeURIComponent(u.username)]) {
        if (segredo && segredo.length >= 3) t = t.split(segredo).join("[oculto]");
      }
    } catch {
      /* URL inválida: segue só com a limpeza por padrão */
    }
  }
  t = t.replace(/postgres(ql)?:\/\/[^\s"')]+/gi, "[url-oculta]");
  return t.slice(0, 500);
}

interface ErroLegivel {
  nome: string;
  codigo?: string;
  mensagem: string;
  causa?: { codigo?: string; mensagem: string };
}

function erroLegivel(e: unknown): ErroLegivel {
  const err = e as { name?: string; code?: string; message?: string; severity?: string; cause?: unknown };
  const causa = err?.cause as { code?: string; message?: string } | undefined;
  return {
    nome: limpar(String(err?.name ?? "Error")),
    codigo: err?.code ? limpar(String(err.code)) : undefined,
    mensagem: limpar(String(err?.message ?? e)),
    causa: causa ? { codigo: causa.code ? limpar(String(causa.code)) : undefined, mensagem: limpar(String(causa.message ?? "")) } : undefined,
  };
}

type Resultado = { ok: boolean; ms: number; detalhe?: unknown; erro?: ErroLegivel; timeout?: boolean };

async function etapa(inicioDaRota: number, nome: string, fn: () => Promise<unknown>, timeoutMs = TIMEOUT_ETAPA_MS): Promise<Resultado> {
  if (Date.now() - inicioDaRota > ORCAMENTO_TOTAL_MS) {
    return { ok: false, ms: 0, erro: { nome: "Ignorada", mensagem: `Orçamento total de ${ORCAMENTO_TOTAL_MS} ms esgotado antes de "${nome}".` } };
  }
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(Object.assign(new Error(`timeout após ${timeoutMs} ms`), { name: "TimeoutDiagnostico" })), timeoutMs);
    });
    const detalhe = await Promise.race([fn(), timeout]);
    return { ok: true, ms: Date.now() - t0, detalhe };
  } catch (e) {
    const erro = erroLegivel(e);
    return { ok: false, ms: Date.now() - t0, erro, timeout: erro.nome === "TimeoutDiagnostico" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Mesma regra de período inicial do `page.tsx` (dia 1 até ontem, fuso de Brasília; dia 1 → mês anterior inteiro). */
function periodoInicialDaPagina() {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const hoje = new Date(`${iso}T00:00:00.000Z`);
  const ontem = new Date(hoje.getTime() - 86_400_000);
  const emAndamento = hoje.getUTCDate() > 1;
  const inicio = emAndamento ? new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)) : new Date(Date.UTC(ontem.getUTCFullYear(), ontem.getUTCMonth(), 1));
  return { inicio, fim: ontem };
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

const naoEncontrado = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** Comparação em tempo constante (via hash, para igualar o tamanho). */
function tokenConfere(esperado: string, recebido: string | null): boolean {
  if (!recebido) return false;
  const a = createHash("sha256").update(esperado).digest();
  const b = createHash("sha256").update(recebido).digest();
  return timingSafeEqual(a, b);
}


// ---------------------------------------------------------------------------------------------------------------------
// Isolamento das etapas internas de `buscarVisaoGeralPeriodo`. As consultas abaixo repetem SOMENTE a forma de acesso
// (tabela + filtro de datas) de cada etapa do serviço — nenhuma regra de negócio, agregação ou classificação — e devolvem
// apenas a contagem de linhas. Cada etapa usa um cliente próprio (1 conexão), para uma consulta pendurada não travar as
// demais nem ser confundida com falta de conexão no pool.
// ---------------------------------------------------------------------------------------------------------------------
const TIMEOUT_PASSO_MS = 5_000;
type Db = ReturnType<typeof drizzle<typeof schema>>;

function novoClienteIsolado() {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
  return { client, db: drizzle(client, { schema }) as Db };
}

async function etapaIsolada(inicioDaRota: number, nome: string, exec: (db: Db) => Promise<number>) {
  const { client, db } = novoClienteIsolado();
  try {
    return { etapa: nome, ...(await etapa(inicioDaRota, nome, () => exec(db), TIMEOUT_PASSO_MS)) };
  } finally {
    void client.end({ timeout: 1 }).catch(() => undefined); // não espera uma consulta pendurada
  }
}

function passosDaVisaoGeral(ini: Date, fim: Date): { nome: string; exec: (db: Db) => Promise<number> }[] {
  const t = schema;
  const somaPorLoja = (tabela: typeof t.faturamento | typeof t.brindes | typeof t.cancelamentoSalao | typeof t.cancelamentoDelivery | typeof t.compraDireta) => async (db: Db) =>
    (
      await db
        .select({ codigo: t.unidades.codigo, total: sql<string>`coalesce(sum(${tabela.valor}), 0)` })
        .from(tabela)
        .innerJoin(t.unidades, eq(tabela.unidadeId, t.unidades.id))
        .where(between(tabela.data, ini, fim))
        .groupBy(t.unidades.codigo)
    ).length;
  const primeira = (tabela: typeof t.fechamentoCaixa | typeof t.pdvMaquininha | typeof t.troco | typeof t.conferencia | typeof t.quebraCaixa | typeof t.retiradaDeposito, filtro?: ReturnType<typeof eq>) => async (db: Db) => {
    const consulta = db.select({ min: sql<string | null>`min(${tabela.data})` }).from(tabela);
    return (await (filtro ? consulta.where(filtro) : consulta)).length;
  };
  return [
    { nome: "01 faturamento", exec: somaPorLoja(t.faturamento) },
    {
      nome: "02 formas de pagamento",
      exec: async (db) =>
        (await db.select({ codigo: t.unidades.codigo, forma: t.formasPagamento.forma, valor: t.formasPagamento.valor }).from(t.formasPagamento).innerJoin(t.unidades, eq(t.formasPagamento.unidadeId, t.unidades.id)).where(between(t.formasPagamento.data, ini, fim))).length,
    },
    {
      nome: "03 brindes",
      exec: async (db) =>
        (await db.select({ codigo: t.unidades.codigo, motivo: t.brindes.motivo, motivo2: t.brindes.motivo2, total: sql<string>`coalesce(sum(${t.brindes.valor}), 0)` }).from(t.brindes).innerJoin(t.unidades, eq(t.brindes.unidadeId, t.unidades.id)).where(between(t.brindes.data, ini, fim)).groupBy(t.unidades.codigo, t.brindes.motivo, t.brindes.motivo2)).length,
    },
    { nome: "04 cancelamento salão", exec: somaPorLoja(t.cancelamentoSalao) },
    { nome: "05 cancelamento delivery", exec: somaPorLoja(t.cancelamentoDelivery) },
    { nome: "06/07 compra direta (retirada compra direta)", exec: somaPorLoja(t.compraDireta) },
    {
      nome: "08a retirada depósito (por loja)",
      exec: async (db) =>
        (await db.select({ codigo: t.unidades.codigo, total: sql<string>`coalesce(sum(${t.retiradaDeposito.valor}), 0)` }).from(t.retiradaDeposito).innerJoin(t.unidades, eq(t.retiradaDeposito.unidadeId, t.unidades.id)).where(and(between(t.retiradaDeposito.data, ini, fim), eq(t.retiradaDeposito.motivo, "DEPÓSITO"))).groupBy(t.unidades.codigo)).length,
    },
    {
      nome: "08b retirada depósito (existência da base)",
      exec: async (db) => (await db.select({ total: sql<string>`count(*)` }).from(t.retiradaDeposito).where(eq(t.retiradaDeposito.motivo, "DEPÓSITO"))).length,
    },
    { nome: "09 fechamento de caixa", exec: async (db) => (await db.select({ id: t.fechamentoCaixa.id }).from(t.fechamentoCaixa).where(between(t.fechamentoCaixa.data, ini, fim))).length },
    {
      nome: "10 PDV × maquininha",
      exec: async (db) => (await db.select({ valorPdv: t.pdvMaquininha.valorPdv, valorMaquininha: t.pdvMaquininha.valorMaquininha }).from(t.pdvMaquininha).where(between(t.pdvMaquininha.data, ini, fim))).length,
    },
    { nome: "11 troco", exec: async (db) => (await db.select({ diferenca: t.troco.diferenca }).from(t.troco).where(between(t.troco.data, ini, fim))).length },
    {
      nome: "12 conferência",
      exec: async (db) => (await db.select({ qtdCadastrados: t.conferencia.qtdCadastrados, qtdConferidos: t.conferencia.qtdConferidos, emAtraso: t.conferencia.emAtraso }).from(t.conferencia).where(between(t.conferencia.data, ini, fim))).length,
    },
    {
      nome: "13 quebra de caixa",
      exec: async (db) => (await db.select({ codigo: t.unidades.codigo, valor: t.quebraCaixa.valor }).from(t.quebraCaixa).innerJoin(t.unidades, eq(t.quebraCaixa.unidadeId, t.unidades.id)).where(between(t.quebraCaixa.data, ini, fim))).length,
    },
    { nome: "15a cobertura retirada depósito", exec: primeira(t.retiradaDeposito, eq(t.retiradaDeposito.motivo, "DEPÓSITO")) },
    { nome: "15b cobertura fechamento", exec: primeira(t.fechamentoCaixa) },
    { nome: "15c cobertura PDV", exec: primeira(t.pdvMaquininha) },
    { nome: "15d cobertura troco", exec: primeira(t.troco) },
    { nome: "15e cobertura conferência", exec: primeira(t.conferencia) },
    { nome: "15f cobertura quebra", exec: primeira(t.quebraCaixa) },
  ];
}

/** Fotografia das consultas ativas no banco (texto SQL parametrizado: sem valores de negócio). */
async function amostraDeAtividade() {
  const { client, db } = novoClienteIsolado();
  try {
    const linhas = await db.execute(sql`
      select state, wait_event_type, wait_event,
             round(extract(epoch from (now() - query_start)) * 1000)::int as ms_desde_inicio,
             left(regexp_replace(query, '\s+', ' ', 'g'), 260) as consulta
      from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'
        and application_name not in ('postgres_exporter', 'pg_cron scheduler', 'pg_net 0.20.4', 'Supavisor (auth_query)')
      order by query_start limit 25`);
    return (linhas as unknown as Record<string, unknown>[]).map((l) => ({
      estado: String(l.state ?? ""),
      espera: l.wait_event_type ? `${String(l.wait_event_type)}/${String(l.wait_event)}` : null,
      msDesdeInicio: Number(l.ms_desde_inicio ?? 0),
      consulta: limpar(String(l.consulta ?? "")),
    }));
  } catch (e) {
    return { erro: erroLegivel(e) };
  } finally {
    void client.end({ timeout: 1 }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Prova de hipótese (pipelining do postgres-js sobre o pooler em modo transação): dispara N consultas simples ao mesmo
// tempo, com clientes próprios e descartáveis (o pool compartilhado do app não é usado), e mede quantas concluem.
// ---------------------------------------------------------------------------------------------------------------------
const TIMEOUT_PROVA_MS = 10_000;

async function provaDePipeline(ini: Date, fim: Date, n: number, opcoes: Record<string, unknown>) {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false, ...opcoes } as never);
  const db = drizzle(client, { schema }) as Db;
  const t0 = Date.now();
  const tempos: number[] = [];
  let erros = 0;
  let ultimoErro: ErroLegivel | undefined;
  const consultas = Array.from({ length: n }, () =>
    db
      .select({ n: sql<string>`count(*)` })
      .from(faturamento)
      .where(between(faturamento.data, ini, fim))
      .then(() => void tempos.push(Date.now() - t0))
      .catch((e) => {
        erros++;
        ultimoErro = erroLegivel(e);
      })
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const venceu = await Promise.race([
    Promise.all(consultas).then(() => "concluiu" as const),
    new Promise<"timeout">((r) => {
      timer = setTimeout(() => r("timeout"), TIMEOUT_PROVA_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
  const ms = Date.now() - t0;
  const resultado = {
    consultasEnviadas: n,
    concluidasOk: tempos.length,
    comErro: erros,
    pendentesAoFinal: n - tempos.length - erros,
    resultado: venceu === "timeout" ? "TIMEOUT (trava)" : erros > 0 ? "ERRO" : "OK",
    ms,
    tempoDaConsultaMs: tempos.length ? { min: Math.min(...tempos), max: Math.max(...tempos) } : null,
    ultimoErro,
  };
  void client.end({ timeout: 1 }).catch(() => undefined);
  return resultado;
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function GET(request: Request) {
  const tokenEsperado = process.env.DIAG_TOKEN;
  if (!tokenEsperado) return naoEncontrado(); // sem token configurado a rota não existe
  const urlReq = new URL(request.url);
  if (!tokenConfere(tokenEsperado, request.headers.get("x-diag-token") ?? urlReq.searchParams.get("token"))) return naoEncontrado();

  const inicioDaRota = Date.now(); // por requisição (a instância pode ser reaproveitada)
  const params = urlReq.searchParams;
  const so = params.get("so");
  const inicioParam = params.get("inicio");
  const fimParam = params.get("fim");
  const periodoValido = Boolean(inicioParam && fimParam && DATA_VALIDA.test(inicioParam) && DATA_VALIDA.test(fimParam));
  const inicio = periodoValido ? dataDoInput(inicioParam!) : dataDoInput("2026-09-01");
  const fim = periodoValido ? dataDoInput(fimParam!) : dataDoInput("2026-09-30");
  const quer = (n: string) => (so ? so === n : n !== "visao" && n !== "real" && n !== "pipeline");

  const saida: Record<string, unknown> = { versao: "diag-3", periodoTestado: `${dia(inicio)} a ${dia(fim)}`, timeoutPorEtapaMs: TIMEOUT_ETAPA_MS };

  if (quer("ambiente")) {
    let host: string | null = null;
    let porta: string | null = null;
    try {
      const u = new URL(process.env.DATABASE_URL ?? "");
      host = u.hostname;
      porta = u.port || "(padrão)";
    } catch {
      /* sem URL válida */
    }
    saida.ambiente = {
      databaseUrlDefinida: Boolean(process.env.DATABASE_URL),
      host,
      porta,
      regiaoVercel: process.env.VERCEL_REGION ?? null,
      node: process.version,
      relogioServidorUtc: new Date().toISOString(),
      periodoInicialDaPagina: (() => {
        const p = periodoInicialDaPagina();
        return `${dia(p.inicio)} a ${dia(p.fim)}`;
      })(),
    };
  }

  const db = process.env.DATABASE_URL ? getDb() : null;
  if (!db) {
    saida.erro = "DATABASE_URL não definida neste ambiente — nenhuma etapa de banco foi executada.";
    return NextResponse.json(saida, { headers: { "Cache-Control": "no-store" } });
  }

  if (quer("ping")) saida.ping = await etapa(inicioDaRota, "ping", async () => (await db.execute(sql`select 1 as ok`)).length);
  if (quer("contagem")) {
    saida.contagem = await etapa(inicioDaRota, "contagem", async () => {
      const [r] = await db.select({ n: sql<string>`count(*)` }).from(faturamento);
      return { linhasFaturamento: Number(r.n) };
    });
  }
  if (quer("visao")) {
    saida.visaoGeral = await etapa(inicioDaRota, "visaoGeral", async () => {
      const d = await buscarVisaoGeralPeriodo(inicio, fim);
      return { conectado: d.conectado, periodoRetornado: `${dia(d.dataInicio)} a ${dia(d.dataFim)}`, lojas: d.detalhamentoPorLoja.length, temMesAnterior: d.mesAnterior !== null };
    });
  }
  if (quer("desempenho")) {
    saida.desempenho = await etapa(inicioDaRota, "desempenho", async () => {
      const d = await buscarDesempenhoCaixa(inicio, fim);
      return { conectado: d.conectado, indicadores: d.indicadores.length };
    });
  }
  if (quer("ssr")) {
    const p = periodoInicialDaPagina();
    saida.ssrInicial = await etapa(inicioDaRota, "ssrInicial", async () => {
      const [vg, dc] = await Promise.allSettled([buscarVisaoGeralPeriodo(p.inicio, p.fim), buscarDesempenhoCaixa(p.inicio, p.fim)]);
      const resumo = (r: PromiseSettledResult<unknown>) => (r.status === "fulfilled" ? { ok: true } : { ok: false, erro: erroLegivel(r.reason) });
      return { periodo: `${dia(p.inicio)} a ${dia(p.fim)}`, visaoGeral: resumo(vg), desempenho: resumo(dc) };
    });
  }

  if (quer("etapas")) {
    const passos = passosDaVisaoGeral(inicio, fim);
    const sequencial = params.get("seq") === "1";
    const t0 = Date.now();
    const resultados: Awaited<ReturnType<typeof etapaIsolada>>[] = [];
    if (sequencial) {
      for (const p of passos) resultados.push(await etapaIsolada(inicioDaRota, p.nome, p.exec));
    } else {
      resultados.push(...(await Promise.all(passos.map((p) => etapaIsolada(inicioDaRota, p.nome, p.exec)))));
    }
    // Item 14 (dia anterior): o serviço só consulta fora do modo período (início = fim); aqui não se executa.
    const ant = mesAnteriorCompleto(inicio, fim);
    const mesAnt = ant
      ? await etapa(inicioDaRota, "16 mês anterior (função real, sem recursão)", () => buscarVisaoGeralPeriodo(ant.inicio, ant.fim, false).then((d) => ({ periodo: `${dia(ant.inicio)} a ${dia(ant.fim)}`, lojas: d.detalhamentoPorLoja.length })), TIMEOUT_PASSO_MS)
      : null;
    saida.etapas = {
      modo: sequencial ? "sequencial" : "paralelo (cada etapa com cliente próprio)",
      timeoutPorEtapaMs: TIMEOUT_PASSO_MS,
      tabela: [
        ...resultados.map((r) => ({ etapa: r.etapa, resultado: r.ok ? "OK" : r.timeout ? "TIMEOUT" : "ERRO", ms: r.ms, linhas: r.ok ? r.detalhe : undefined, erro: r.erro })),
        { etapa: "14 dia anterior", resultado: "NÃO EXECUTADA", ms: 0, erro: { nome: "n/a", mensagem: "o serviço só consulta o dia anterior quando início = fim (modo período não consulta)" } },
        mesAnt
          ? { etapa: "16 mês anterior (função real, sem recursão)", resultado: mesAnt.ok ? "OK" : mesAnt.timeout ? "TIMEOUT" : "ERRO", ms: mesAnt.ms, erro: mesAnt.erro }
          : { etapa: "16 mês anterior", resultado: "NÃO APLICÁVEL", ms: 0, erro: { nome: "n/a", mensagem: "o período não é um mês calendário completo" } },
      ],
      totalMs: Date.now() - t0,
    };
  }
  if (quer("pipeline")) {
    const n = Math.min(Math.max(Number(params.get("n") ?? 34) || 34, 1), 100);
    const reps = Math.min(Math.max(Number(params.get("reps") ?? 2) || 2, 1), 3);
    const base = { max: 3, idle_timeout: 20, connect_timeout: 10 };
    const rodadas: { configuracao: string; rodada: number; [k: string]: unknown }[] = [];
    for (let r = 1; r <= reps; r++) {
      rodadas.push({ configuracao: "atual (max 3, max_pipeline padrão = 100)", rodada: r, ...(await provaDePipeline(inicio, fim, n, base)) });
      rodadas.push({ configuracao: "max_pipeline: 1 (max 3)", rodada: r, ...(await provaDePipeline(inicio, fim, n, { ...base, max_pipeline: 1 })) });
    }
    saida.pipeline = { consultasPorRodada: n, timeoutPorRodadaMs: TIMEOUT_PROVA_MS, rodadas };
  }
  if (quer("real")) {
    const amostras: unknown[] = [];
    const pendentes: Promise<void>[] = [];
    const timers = [4_000, 9_000, 13_000].map((ms) =>
      setTimeout(() => {
        pendentes.push(amostraDeAtividade().then((a) => void amostras.push({ aoRedorDeMs: ms, consultasAtivas: a })));
      }, ms)
    );
    const real = await etapa(inicioDaRota, "visaoGeralReal", async () => {
      const d = await buscarVisaoGeralPeriodo(inicio, fim);
      return { periodoRetornado: `${dia(d.dataInicio)} a ${dia(d.dataFim)}`, lojas: d.detalhamentoPorLoja.length };
    });
    timers.forEach(clearTimeout);
    await Promise.allSettled(pendentes);
    await esperar(0);
    saida.visaoGeralReal = { ...real, amostrasDeAtividadeNoBanco: amostras };
  }

  saida.totalMs = Date.now() - inicioDaRota;
  return NextResponse.json(saida, { headers: { "Cache-Control": "no-store" } });
}
