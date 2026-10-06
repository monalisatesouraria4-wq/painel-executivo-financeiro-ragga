import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { faturamento } from "@/lib/db/schema";
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
 * Opcional: &so=ambiente|ping|contagem|visao|desempenho|ssr
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

async function etapa(inicioDaRota: number, nome: string, fn: () => Promise<unknown>): Promise<Resultado> {
  if (Date.now() - inicioDaRota > ORCAMENTO_TOTAL_MS) {
    return { ok: false, ms: 0, erro: { nome: "Ignorada", mensagem: `Orçamento total de ${ORCAMENTO_TOTAL_MS} ms esgotado antes de "${nome}".` } };
  }
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(Object.assign(new Error(`timeout após ${TIMEOUT_ETAPA_MS} ms`), { name: "TimeoutDiagnostico" })), TIMEOUT_ETAPA_MS);
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
  const quer = (n: string) => !so || so === n;

  const saida: Record<string, unknown> = { versao: "diag-1", periodoTestado: `${dia(inicio)} a ${dia(fim)}`, timeoutPorEtapaMs: TIMEOUT_ETAPA_MS };

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

  saida.totalMs = Date.now() - inicioDaRota;
  return NextResponse.json(saida, { headers: { "Cache-Control": "no-store" } });
}
