/**
 * Comando permanente "atualizar base": identifica as planilhas enviadas, valida com os parsers OFICIAIS, mostra o que
 * precisa de decisão e (só com --gravar) atualiza pela importação oficial (`processarArquivoBase`), uma base por vez.
 *
 *   npm run atualizar-bases -- <planilha.xlsx> [<planilha2.xlsx> ...]                       → SIMULAÇÃO (não grava nada)
 *   npm run atualizar-bases -- <planilhas…> --gravar [--plano <plano.json>]                  → grava (com as conferências)
 *
 * Opções: --ref AAAA-MM-DD (data de referência de Conferência/Quebra; padrão: hoje em Brasília),
 *         --aceitar base1,base2 (aceita, para essas bases, as rejeições que pedem atenção),
 *         --plano <arquivo> (na gravação, exige que a nova simulação seja IGUAL à do plano gerado na simulação).
 * Exit code: 0 = ok · 2 = há bloqueio/decisão pendente (nada foi gravado) · 1 = erro/divergência.
 *
 * Garantias: só upsert pela chave oficial de cada base (nunca apaga histórico); cada base é re-simulada antes de gravar;
 * contagem depois = antes + inseridos; interrompe na primeira divergência; guarda referência (contagem + hash) das tabelas
 * antes de gravar e compara ao final. Requer DATABASE_URL (apps/web/.env.local).
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import postgres from "postgres";
import { lerArquivoExcel } from "../lib/import/lerArquivoExcel";
import { buscarBaseInfo, processarArquivoBase, validarColunas, type BaseId } from "../lib/services/atualizacaoBases";
import { identificarBase } from "../lib/import/identificarBase";
import { assinaturaRejeicao, resumirClasses, type RejeicaoParaClassificar } from "../lib/import/classificarRejeicoes";
import { localizarColuna } from "../lib/import/localizarColuna";
import { resolverAbaConferenciaPorData, type AbaConferenciaBruta } from "../lib/import/resolverAbaConferencia";
import { resolverAbaQuebraPorData, type AbaQuebraBruta } from "../lib/import/resolverAbaQuebra";
import { parseFaturamento } from "../lib/import/parsers/faturamento";
import { parseFechamentoCaixa } from "../lib/import/parsers/fechamentoCaixa";
import { parsePdvMaquininha } from "../lib/import/parsers/pdvMaquininha";
import { parseTroco } from "../lib/import/parsers/troco";
import { parseRetiradaDeposito } from "../lib/import/parsers/retiradaDeposito";
import { parseListaSimples, CONFIGS_LISTA_SIMPLES } from "../lib/import/parsers/listaSimples";
import { parseConferencia } from "../lib/import/parsers/conferencia";
import { parseQuebraCaixa } from "../lib/import/parsers/quebraCaixa";
import { parseCancelamentoSalaoDetalhe } from "../lib/import/parsers/cancelamentoSalaoDetalhe";
import { parseDataCelula, parseValorCelula } from "../lib/import/parseCelula";
import { conferirLotePdv, validarCabecalhoPdv } from "../lib/import/conferenciaPdv";
import type { ResultadoParse } from "../lib/import/tipos";

const TABELA: Record<BaseId, string> = {
  brindes: "brindes",
  cancelamentoSalao: "cancelamento_salao",
  cancelamentoDelivery: "cancelamento_delivery",
  compraDireta: "compra_direta",
  conferencia: "conferencia",
  quebraCaixa: "quebra_caixa",
  fechamento: "fechamento_caixa",
  pdvMaquininha: "pdv_maquininha",
  retiradaDeposito: "retirada_deposito",
  troco: "troco",
  faturamento: "faturamento",
};
/** Ordem fixa de gravação (a mesma das atualizações anteriores). */
const ORDEM: BaseId[] = ["brindes", "cancelamentoSalao", "cancelamentoDelivery", "compraDireta", "conferencia", "quebraCaixa", "fechamento", "pdvMaquininha", "retiradaDeposito", "troco", "faturamento"];

const dia = (d: Date) => d.toISOString().slice(0, 10);
const hojeBrasil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

interface Args { arquivos: string[]; gravar: boolean; ref: string; plano?: string; aceitar: string[] }
function lerArgs(argv: string[]): Args {
  const a: Args = { arquivos: [], gravar: false, ref: hojeBrasil(), aceitar: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--gravar") a.gravar = true;
    else if (v === "--simular") a.gravar = false;
    else if (v === "--ref") a.ref = argv[++i];
    else if (v === "--plano") a.plano = argv[++i];
    else if (v === "--aceitar") a.aceitar = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else a.arquivos.push(v);
  }
  return a;
}

function aceitasDoRepositorio(): string[] {
  const caminho = resolve(process.cwd(), "scripts", "rejeicoes-aceitas.json");
  if (!existsSync(caminho)) return [];
  const j = JSON.parse(readFileSync(caminho, "utf-8")) as { aceitas?: string[] };
  return j.aceitas ?? [];
}

function executarParser(id: BaseId, cab: unknown[], ln: unknown[][]): ResultadoParse {
  switch (id) {
    case "faturamento": return parseFaturamento(cab, ln);
    case "fechamento": return parseFechamentoCaixa(cab, ln);
    case "pdvMaquininha": return parsePdvMaquininha(cab, ln);
    case "troco": return parseTroco(cab, ln);
    case "retiradaDeposito": return parseRetiradaDeposito(cab, ln);
    case "brindes": return parseListaSimples(cab, ln, CONFIGS_LISTA_SIMPLES.brindes);
    case "cancelamentoSalao": return parseListaSimples(cab, ln, CONFIGS_LISTA_SIMPLES.cancelamento_salao);
    case "cancelamentoDelivery": return parseListaSimples(cab, ln, CONFIGS_LISTA_SIMPLES.cancelamento_delivery);
    case "compraDireta": return parseListaSimples(cab, ln, CONFIGS_LISTA_SIMPLES.compra_direta);
    default: throw new Error(`base sem parser simples: ${id}`);
  }
}

interface Simulacao {
  base: BaseId;
  arquivo: string;
  ok: boolean;
  bloqueio?: string;
  validos: number;
  rejeitados: number;
  lojas: number;
  periodo: string;
  extra: string;
  rejeicoes: RejeicaoParaClassificar[];
}

async function simular(base: BaseId, arquivo: string, file: File, ref: Date): Promise<Simulacao> {
  const s: Simulacao = { base, arquivo, ok: false, validos: 0, rejeitados: 0, lojas: 0, periodo: "—", extra: "", rejeicoes: [] };
  const pl = await lerArquivoExcel(file);
  let res: ResultadoParse;
  if (base === "quebraCaixa") {
    const abas: AbaQuebraBruta[] = Object.entries(pl.sheets).map(([nomeAba, linhas]) => {
      const cab = linhas[3] ?? [];
      const iD = localizarColuna(cab, "DATA");
      const iL = localizarColuna(cab, "LOJA");
      const datas: Date[] = [];
      for (const l of linhas.slice(4)) {
        if (l[iL] === null || l[iL] === undefined || l[iL] === "") continue;
        const d = parseDataCelula(l[iD]);
        if (d) datas.push(d);
      }
      return { nomeAba, datasLancamentos: datas };
    });
    const r = resolverAbaQuebraPorData(ref, abas);
    if (!r.resultado.ok) return { ...s, bloqueio: `aba de Quebra não resolvida para ${dia(ref)}: ${r.resultado.erro}` };
    const aba = r.resultado.aba;
    const ln = pl.sheets[aba.nomeAba] ?? [];
    res = parseQuebraCaixa(ln[3] ?? [], ln.slice(4));
    s.extra = `ciclo: aba "${aba.nomeAba}" (${dia(aba.periodoInicio)} a ${dia(aba.periodoFim)})`;
  } else if (base === "conferencia") {
    const abas: AbaConferenciaBruta[] = Object.entries(pl.sheets).map(([nomeAba, linhas]) => ({ nomeAba, celulasLinhaDeDatas: (linhas[5] ?? []).slice(3) }));
    const r = resolverAbaConferenciaPorData(ref, abas);
    if (!r.resultado.ok) return { ...s, bloqueio: `aba de Conferência não resolvida para ${dia(ref)}: ${r.resultado.erro}` };
    const aba = r.resultado.aba;
    const ln = pl.sheets[aba.nomeAba] ?? [];
    res = parseConferencia(ln[5] ?? [], ln.slice(6), aba.id);
    s.extra = `ciclo: aba "${aba.nomeAba}" (${dia(aba.periodoInicio)} a ${dia(aba.periodoFim)})`;
  } else {
    const cab = pl.sheets[pl.primeiraAba]?.[0] ?? [];
    const linhas = (pl.sheets[pl.primeiraAba] ?? []).slice(1);
    const faltando = validarColunas(cab, buscarBaseInfo(base).colunasObrigatorias ?? []);
    if (faltando.length) return { ...s, bloqueio: `colunas obrigatórias ausentes: ${faltando.join(", ")}` };
    if (base === "pdvMaquininha") {
      const c = validarCabecalhoPdv(cab);
      if (!c.ok) return { ...s, bloqueio: `PDV: colunas ausentes: ${c.faltando.join(", ")}` };
    }
    res = executarParser(base, cab, linhas);
    if (base === "pdvMaquininha") {
      const maqEmBranco = linhas.filter((l) => l[0] && String(l[0]).toUpperCase() !== "TOTAL" && parseValorCelula(l[4]) === null).length;
      const lote = conferirLotePdv(res.registros as never, maqEmBranco);
      s.extra = `PDV: chaves únicas ${lote.chavesUnicas}/${lote.linhas}, colisões ${lote.colisoes}, forma vazia ${lote.formasVazias}`;
      if (lote.bloqueios.length) return { ...s, validos: res.registros.length, rejeitados: res.rejeitados.length, bloqueio: `PDV: ${lote.bloqueios.join(" | ")}` };
    }
    if (base === "cancelamentoSalao") {
      const d = parseCancelamentoSalaoDetalhe(cab, linhas);
      s.extra = `detalhes individuais: ${d.registros.length} (rejeitados ${d.rejeitados.length}; madrugada 00h31–05h59: ${d.registros.filter((x) => x.madrugada).length})`;
      if (d.rejeitados.length > 0) return { ...s, validos: res.registros.length, rejeitados: res.rejeitados.length, bloqueio: `${d.rejeitados.length} estorno(s) individuais rejeitados (ex.: ${d.rejeitados[0].motivo})` };
    }
  }
  if (res.registros.length === 0) return { ...s, rejeitados: res.rejeitados.length, bloqueio: "nenhum registro válido" };
  const ts = res.registros.map((r) => r.data.getTime());
  return {
    ...s,
    ok: true,
    validos: res.registros.length,
    rejeitados: res.rejeitados.length,
    lojas: new Set(res.registros.map((r) => r.unidade)).size,
    periodo: `${dia(new Date(Math.min(...ts)))} a ${dia(new Date(Math.max(...ts)))}`,
    rejeicoes: res.rejeitados.map((x) => ({ linhaOrigem: x.linhaOrigem, motivo: x.motivo, valoresBrutos: x.valoresBrutos })),
  };
}

type Snap = Record<string, { n: number; hash: string }>;
async function snapshot(sql: postgres.Sql, tabelas: string[]): Promise<Snap> {
  const out: Snap = {};
  for (const t of tabelas) {
    const [r] = await sql.unsafe(
      `select count(*)::int n, md5(coalesce(string_agg(j, ',' order by j), '')) h from (select (to_jsonb(x) - 'id' - 'criado_em' - 'atualizado_em' - 'importacao_id' - 'fonte_periodo_id')::text j from ${t} x) s`
    );
    out[t] = { n: r.n as number, hash: r.h as string };
  }
  return out;
}

async function main() {
  const args = lerArgs(process.argv.slice(2));
  if (args.arquivos.length === 0) {
    console.log("Uso: npm run atualizar-bases -- <planilha.xlsx> [...] [--gravar] [--ref AAAA-MM-DD] [--aceitar base,base] [--plano plano.json]");
    process.exit(1);
  }
  const ref = new Date(`${args.ref}T00:00:00Z`);
  const aceitasRepo = aceitasDoRepositorio();
  console.log(args.gravar ? "MODO: GRAVAR" : "MODO: SIMULAÇÃO (nada será gravado)", `| referência: ${args.ref}`);

  // 1) identificar os arquivos
  const arquivos = new Map<string, File>();
  const porBase = new Map<BaseId, string[]>();
  const bloqueios: string[] = [];
  console.log("\n== ARQUIVOS IDENTIFICADOS ==");
  for (const caminho of args.arquivos) {
    const nome = basename(caminho);
    if (!existsSync(caminho)) { bloqueios.push(`arquivo não encontrado: ${caminho}`); console.log(`⛔ ${nome}: não encontrado`); continue; }
    const file = new File([readFileSync(caminho)], nome);
    arquivos.set(nome, file);
    const pl = await lerArquivoExcel(file);
    const id = identificarBase({ nomeArquivo: nome, abas: Object.keys(pl.sheets), cabecalhoPrimeiraAba: pl.sheets[pl.primeiraAba]?.[0] ?? [] });
    if (id.status !== "ok") { bloqueios.push(`${nome}: ${id.status} — ${id.motivo}`); console.log(`⛔ ${nome}: ${id.status.toUpperCase()} — ${id.motivo}`); continue; }
    console.log(`✔ ${nome} → ${id.bases.join(" + ")} (${id.motivo})`);
    for (const b of id.bases) porBase.set(b, [...(porBase.get(b) ?? []), nome]);
  }
  for (const [b, nomes] of porBase) if (nomes.length > 1) bloqueios.push(`mais de um arquivo para ${b}: ${nomes.join("; ")} — informe qual usar`);

  // 2) simular todas as bases identificadas
  const bases = ORDEM.filter((b) => porBase.has(b));
  const sims: Simulacao[] = [];
  console.log("\n== SIMULAÇÃO (parsers e regras oficiais) ==");
  for (const b of bases) {
    const nome = porBase.get(b)![0];
    const s = await simular(b, nome, arquivos.get(nome)!, ref);
    sims.push(s);
    if (!s.ok || s.bloqueio) { bloqueios.push(`${b}: ${s.bloqueio ?? "simulação reprovada"}`); console.log(`⛔ ${b.padEnd(21)} ${s.bloqueio}`); continue; }
    const cls = resumirClasses(b, s.rejeicoes, aceitasRepo);
    const aceitarTudo = args.aceitar.includes(b);
    const pendentes = aceitarTudo ? [] : cls.atencao;
    console.log(`✔ ${b.padEnd(21)} ${s.validos} válidos | ${s.rejeitados} rejeitados | ${s.lojas} lojas | ${s.periodo}${s.extra ? " | " + s.extra : ""}`);
    const partes = [
      cls["em-branco"].length ? `${cls["em-branco"].length} em branco` : "",
      cls.estrutural.length ? `${cls.estrutural.length} totais/legendas da planilha` : "",
      cls["fora-de-escopo"].length ? `${cls["fora-de-escopo"].length} fora do escopo da base` : "",
      cls.aceita.length ? `${cls.aceita.length} já aceitas` : "",
    ].filter(Boolean);
    if (partes.length) console.log(`   rejeições esperadas: ${partes.join(", ")}`);
    for (const r of pendentes) {
      console.log(`   ⚠ PRECISA DE DECISÃO (linha ${r.linhaOrigem}): ${r.motivo} | ${JSON.stringify(r.valoresBrutos ?? {}).slice(0, 200)}`);
      console.log(`     assinatura: ${assinaturaRejeicao(b, r)}`);
    }
    if (pendentes.length) bloqueios.push(`${b}: ${pendentes.length} rejeição(ões) que pedem decisão (corrija a planilha ou use --aceitar ${b})`);
  }

  const planoPath = args.plano ?? join(tmpdir(), "atualizar-bases-plano.json");
  if (!args.gravar) {
    writeFileSync(planoPath, JSON.stringify({ ref: args.ref, bases: Object.fromEntries(sims.map((s) => [s.base, { arquivo: s.arquivo, validos: s.validos, rejeitados: s.rejeitados }])) }, null, 1));
    console.log(`\nplano da simulação salvo em: ${planoPath}`);
    if (bloqueios.length) { console.log("\n⛔ PENDÊNCIAS (nada foi gravado):"); for (const b of bloqueios) console.log("  -", b); process.exit(2); }
    console.log("\nSIMULAÇÃO concluída: tudo validado, nada foi gravado.");
    process.exit(0);
  }

  // 3) gravação: só com tudo validado
  if (bloqueios.length) { console.log("\n⛔ NÃO GRAVADO — pendências:"); for (const b of bloqueios) console.log("  -", b); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.log("⛔ DATABASE_URL não configurada (apps/web/.env.local)"); process.exit(1); }
  const plano = args.plano && existsSync(args.plano) ? (JSON.parse(readFileSync(args.plano, "utf-8")) as { bases: Record<string, { validos: number; rejeitados: number }> }) : null;
  if (plano) for (const s of sims) {
    const p = plano.bases[s.base];
    if (!p || p.validos !== s.validos || p.rejeitados !== s.rejeitados) { console.log(`⛔ ${s.base}: a nova simulação (${s.validos}/${s.rejeitados}) difere do plano (${p ? `${p.validos}/${p.rejeitados}` : "ausente"}) — NADA gravado`); process.exit(1); }
  }

  const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
  const parar = async (msg: string): Promise<never> => { console.log("\n⛔ INTERROMPIDO:", msg); await sql.end(); process.exit(1); };
  const tabelas = [...new Set([...bases.map((b) => TABELA[b]), ...(bases.includes("cancelamentoSalao") ? ["cancelamento_salao_detalhe"] : [])])];
  const inicial = await snapshot(sql, tabelas);
  const refPath = join(tmpdir(), `atualizar-bases-referencia-${Date.now()}.json`);
  writeFileSync(refPath, JSON.stringify({ quando: new Date().toISOString(), tabelas: inicial }, null, 1));
  console.log(`\n== REFERÊNCIA DE SEGURANÇA (contagem · hash) — salva em ${refPath} ==`);
  for (const t of tabelas) console.log(`  ${t.padEnd(28)} ${String(inicial[t].n).padStart(6)} · ${inicial[t].hash}`);

  const relatorio: string[] = [];
  for (const s of sims) {
    console.log(`\n── ${s.base} (${s.arquivo}) ──`);
    const tab = TABELA[s.base];
    const antes = (await snapshot(sql, [tab]))[tab];
    const detAntes = s.base === "cancelamentoSalao" ? (await snapshot(sql, ["cancelamento_salao_detalhe"])).cancelamento_salao_detalhe : null;
    const r = await processarArquivoBase(s.base, arquivos.get(s.arquivo)!, [], ref);
    if (r.status === "erro") return parar(`${s.base}: ${r.mensagem}`);
    const depois = (await snapshot(sql, [tab]))[tab];
    const esperado = antes.n + r.inseridos;
    let linha = `  inseridos ${r.inseridos} | atualizados ${r.atualizados} | rejeitados ${r.rejeitados} | tabela ${antes.n} → ${depois.n} (esperado ${esperado}) ${depois.n === esperado ? "✔" : "⚠ DIVERGE"}`;
    if (r.rejeitados !== s.rejeitados) { console.log(linha); await parar(`${s.base}: rejeitados diferentes da simulação (${r.rejeitados} × ${s.rejeitados})`); }
    if (depois.n !== esperado) { console.log(linha); await parar(`contagem divergente em ${s.base}`); }
    if (detAntes) {
      const det = (await snapshot(sql, ["cancelamento_salao_detalhe"])).cancelamento_salao_detalhe;
      linha += ` | detalhes: ${r.detalhes ? `+${r.detalhes.inseridos} novos, ${r.detalhes.atualizados} atualizados` : "sem retorno"} (${detAntes.n} → ${det.n})`;
      console.log(linha);
      if (r.detalhes?.erro) await parar(`erro nos detalhes: ${r.detalhes.erro}`);
      if (det.n !== detAntes.n + (r.detalhes?.inseridos ?? 0)) await parar("contagem de detalhes divergente");
    } else console.log(linha);
    relatorio.push(`${s.base.padEnd(21)} ${s.validos} válidos | ${r.rejeitados} rej. | +${r.inseridos} novos | ${r.atualizados} atualizados | ${antes.n} → ${depois.n}${depois.hash === antes.hash ? " | conteúdo IDÊNTICO" : ""}`);
  }

  const final = await snapshot(sql, tabelas);
  console.log("\n== ESTADO FINAL × REFERÊNCIA INICIAL ==");
  for (const t of tabelas) console.log(`  ${t.padEnd(28)} ${String(inicial[t].n).padStart(6)} → ${String(final[t].n).padStart(6)} (${final[t].n - inicial[t].n >= 0 ? "+" : ""}${final[t].n - inicial[t].n}) | conteúdo ${inicial[t].hash === final[t].hash ? "IDÊNTICO" : "alterado"}`);
  console.log("\n== RELATÓRIO POR BASE ==");
  for (const l of relatorio) console.log("  " + l);
  await sql.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERRO:", e instanceof Error ? e.message : e); process.exit(1); });
