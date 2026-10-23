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
import { createHash } from "node:crypto";
import { gravarBackupSeguro, gravarBackupSincronizacao } from "../lib/import/backupCorrecao";
import { persistirDetalhesCancelamentoSalao } from "../lib/actions/persistirCancelamentoSalaoDetalhes";
import { bancoCorrecaoPg, snapshot } from "../lib/import/bancoCorrecaoPg";
import { MOTIVO_EXCLUSOES_DESABILITADAS, VARIAVEL_EXCLUSOES, exclusoesHabilitadas } from "../lib/import/exclusoesHabilitadas";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import postgres from "postgres";
import { lerArquivoExcel } from "../lib/import/lerArquivoExcel";
import { buscarBaseInfo, processarArquivoBase, validarColunas, type BaseId } from "../lib/services/atualizacaoBases";
import { identificarBase } from "../lib/import/identificarBase";
import { assinaturaRejeicao, resumirClasses, type RejeicaoParaClassificar } from "../lib/import/classificarRejeicoes";
import { resolverAbaConferenciaPorData, type AbaConferenciaBruta } from "../lib/import/resolverAbaConferencia";
import { lerQuebraDaPlanilha, type QuebraLida } from "../lib/import/quebraDaPlanilha";
import { parseFaturamento } from "../lib/import/parsers/faturamento";
import { parseFormasPagamento } from "../lib/import/parsers/formasPagamento";
import { parseFechamentoCaixa } from "../lib/import/parsers/fechamentoCaixa";
import { parsePdvMaquininha } from "../lib/import/parsers/pdvMaquininha";
import { parseTroco } from "../lib/import/parsers/troco";
import { parseRetiradaDeposito } from "../lib/import/parsers/retiradaDeposito";
import { parseListaSimples, CONFIGS_LISTA_SIMPLES } from "../lib/import/parsers/listaSimples";
import { parseConferencia } from "../lib/import/parsers/conferencia";
import { parseCancelamentoSalaoDetalhe } from "../lib/import/parsers/cancelamentoSalaoDetalhe";
import { parseValorCelula } from "../lib/import/parseCelula";
import { conferirLotePdv, validarCabecalhoPdv } from "../lib/import/conferenciaPdv";
import type { ResultadoParse } from "../lib/import/tipos";
import { restaurarBackup } from "../lib/import/restauracaoBackupPg";
import { executarCorrecao, type RegistroBanco, type SnapshotCorrecao } from "../lib/import/correcaoChave";
import { formatarReais } from "../lib/import/sincronizacao";
import { alinharOcorrenciasComExistentes, chaveNaturalQuebra, chaveOficialQuebra, chavesOficiaisRepetidas } from "../lib/import/ocorrenciaQuebra";
import { baseSnapshot, type LimitesSincronizacao, type OpcoesPlano, type PlanoSincronizacao } from "../lib/import/sincronizacaoBase";
import { planejarNoBanco, sincronizarBase } from "../lib/import/bancoSincronizacaoPg";

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
  formasPagamento: "formas_pagamento",
};
/** Ordem fixa de gravação (a mesma das atualizações anteriores). */
const ORDEM: BaseId[] = ["brindes", "cancelamentoSalao", "cancelamentoDelivery", "compraDireta", "conferencia", "quebraCaixa", "fechamento", "pdvMaquininha", "retiradaDeposito", "troco", "faturamento", "formasPagamento"];

/** SSL obrigatório, exceto para um PostgreSQL LOCAL descartável (host 127.0.0.1/localhost), usado só nos testes de integração. */
const sslPara = (url: string): "require" | false => (/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(url) ? false : "require");
const dia = (d: Date) => d.toISOString().slice(0, 10);
const hojeBrasil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

interface Args { de?: string; ate?: string; somente: string[]; arquivos: string[]; gravar: boolean; ref: string; plano?: string; aceitar: string[]; detalhar: boolean; corrigir?: string; restaurar?: string; removerNovos: boolean; confirmar: boolean; backupDir?: string; hashPlano?: string; aprovarExclusoes: Record<string, string>; semExclusao: string[]; confirmarDiasSemMovimento: string[]; limites: LimitesSincronizacao }
function lerArgs(argv: string[]): Args {
  const a: Args = { somente: [], arquivos: [], gravar: false, ref: hojeBrasil(), aceitar: [], detalhar: false, confirmar: false, removerNovos: false, aprovarExclusoes: {}, semExclusao: [], confirmarDiasSemMovimento: [], limites: {} };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--gravar") a.gravar = true;
    else if (v === "--simular") a.gravar = false;
    else if (v === "--somente") a.somente = (argv[++i] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    else if (v === "--detalhar") a.detalhar = true;
    else if (v === "--corrigir") a.corrigir = argv[++i];
    else if (v === "--confirmar") a.confirmar = true;
    else if (v === "--restaurar") a.restaurar = argv[++i];
    else if (v === "--remover-novos") a.removerNovos = true;
    else if (v === "--backup-dir") a.backupDir = argv[++i];
    else if (v === "--hash-plano") a.hashPlano = argv[++i];
    else if (v === "--aprovar-exclusoes") for (const par of (argv[++i] ?? "").split(",")) { const [b, h] = par.split("="); if (b && h) a.aprovarExclusoes[b.trim()] = h.trim(); }
    else if (v === "--sem-exclusao") a.semExclusao = (argv[++i] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    else if (v === "--confirmar-dias-sem-movimento") a.confirmarDiasSemMovimento = (argv[++i] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    else if (v === "--limite-remocoes") a.limites.maxRemocoes = Number(argv[++i]);
    else if (v === "--limite-remocao-percentual") a.limites.maxRemocaoPercentual = Number(argv[++i]);
    else if (v === "--limite-remocao-valor") a.limites.maxValorRemovidoCentavos = Math.round(Number(argv[++i]) * 100);
    else if (v === "--ref") a.ref = argv[++i];
    else if (v === "--de") a.de = argv[++i];
    else if (v === "--ate") a.ate = argv[++i];
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
    case "formasPagamento": return parseFormasPagamento(cab, ln);
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
  /** Registros válidos da planilha (para o relatório de sincronização com o banco). */
  registros?: ResultadoParse["registros"];
  /** Só Quebra de Caixa: aba, critério de resolução e situação de cada lançamento (para o relatório detalhado). */
  quebra?: QuebraLida;
  /** Só Cancelamento Salão: detalhes individuais dos estornos (gravados pelo fluxo idempotente depois da sincronização). */
  detalhesCS?: Parameters<typeof persistirDetalhesCancelamentoSalao>[0];
}

/** Janela opcional (`--de` / `--ate`, AAAA-MM-DD): só os registros dentro dela entram na simulação, no plano (e no hash) e na gravação. */
let JANELA: { de?: string; ate?: string } = {};
const dentroDaJanela = (d: Date) => (!JANELA.de || dia(d) >= JANELA.de) && (!JANELA.ate || dia(d) <= JANELA.ate);

async function simular(base: BaseId, arquivo: string, file: File, ref: Date): Promise<Simulacao> {
  const s: Simulacao = { base, arquivo, ok: false, validos: 0, rejeitados: 0, lojas: 0, periodo: "—", extra: "", rejeicoes: [] };
  const pl = await lerArquivoExcel(file);
  let res: ResultadoParse;
  if (base === "quebraCaixa") {
    const q = lerQuebraDaPlanilha(pl.sheets, ref);
    if (!q.ok) {
      const inv = q.abasInvalidas.map((a) => `"${a.nomeAba}": ${a.motivo}`).join(" | ");
      return { ...s, bloqueio: `aba de Quebra não resolvida para ${dia(ref)}: ${q.erro}${inv ? ` (abas descartadas: ${inv})` : ""}` };
    }
    res = q.parse;
    s.quebra = q;
    const post = q.situacoes.filter((x) => x === "posterior_ao_ciclo").length;
    s.extra = `aba "${q.aba.nomeAba}" (ciclo ${dia(q.aba.periodoInicio)} a ${dia(q.aba.periodoFim)}; resolvida por ${q.criterio === "ciclo" ? "ciclo" : "cobertura estendida"})${post ? ` | ${post} lançamento(s) posteriores ao ciclo da aba, aceitos pela data real` : ""}`;
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
    if (JANELA.de || JANELA.ate) res = { ...res, registros: res.registros.filter((r) => dentroDaJanela(r.data)) };
    if (base === "pdvMaquininha") {
      const maqEmBranco = linhas.filter((l) => l[0] && String(l[0]).toUpperCase() !== "TOTAL" && parseValorCelula(l[4]) === null).length;
      const lote = conferirLotePdv(res.registros as never, maqEmBranco);
      s.extra = `PDV: chaves únicas ${lote.chavesUnicas}/${lote.linhas}, colisões ${lote.colisoes}, forma vazia ${lote.formasVazias}`;
      if (lote.bloqueios.length) return { ...s, validos: res.registros.length, rejeitados: res.rejeitados.length, bloqueio: `PDV: ${lote.bloqueios.join(" | ")}` };
    }
    if (base === "cancelamentoSalao") {
      const d = parseCancelamentoSalaoDetalhe(cab, linhas);
      s.detalhesCS = d.registros;
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
    registros: res.registros,
  };
}

/** Opções do plano para uma base, a partir dos argumentos (os mesmos na simulação e na gravação). */
function opcoesDaBase(args: Args, base: BaseId, arquivoSha256?: string): OpcoesPlano {
  const limites = Object.keys(args.limites).length ? args.limites : undefined;
  return { limites, confirmarDiasSemMovimento: args.confirmarDiasSemMovimento.includes(base), semExclusao: args.semExclusao.includes(base), arquivoSha256 };
}

/** Imprime o plano de sincronização autoritativa de uma base (somente leitura). */
function imprimirPlano(plano: PlanoSincronizacao, detalhar: boolean): void {
  const R = (c: number) => formatarReais(c);
  if (!plano.escopo) { console.log("   SINCRONIZAÇÃO: fonte vazia — nada a planejar"); return; }
  console.log(`   SINCRONIZAÇÃO AUTORITATIVA (escopo: ${plano.escopo.unidades.length} loja(s) presente(s) no arquivo, ${plano.escopo.inicio} a ${plano.escopo.fim}):`);
  console.log(`     Σ fonte ${R(plano.fonte.centavos)} (${plano.fonte.chaves} chaves) | Σ banco no escopo hoje ${R(plano.bancoNoEscopo.centavos)} (${plano.bancoNoEscopo.chaves} chaves)`);
  console.log(`     novos: ${plano.novos.length} | iguais: ${plano.iguais} | alterados (valor): ${plano.alterados.length} | só no banco (removíveis): ${plano.removiveis.length} (${R(plano.removiveisCentavos)})`);
  if (plano.removiveis.length > 0) {
    console.log(`     removíveis com a mesma loja+dia+valor de uma chave da fonte: ${plano.removiveisComCoincidenciaDeValor} (PISTA de reclassificação, NÃO é prova de identidade)`);
    console.log(`     loja+dias com removíveis: total do dia IGUAL ao da fonte em ${plano.totaisDoDia.iguais} (${R(plano.totaisDoDia.centavosRemoviveisEmDiasIguais)}) | DIFERENTE em ${plano.totaisDoDia.diferentes} (${R(plano.totaisDoDia.centavosRemoviveisEmDiasDiferentes)})`);
  }
  for (const r of plano.riscos) {
    const marca = r.gravidade === "aviso" ? "ℹ" : "⚠";
    console.log(`     ${marca} [${r.codigo}/${r.gravidade}] ${r.descricao}${r.itens && r.itens.length ? ` (ex.: ${r.itens.slice(0, 5).join("; ")})` : ""}`);
  }
  console.log(`     Σ banco no escopo após aplicar: ${R(plano.totalFinalNoEscopoCentavos)} | exclusões autorizadas pelo plano: ${plano.idsParaRemover.length}`);
  const exclusoesBloqueadasAqui = plano.idsParaRemover.length > 0 && !exclusoesHabilitadas();
  console.log(plano.espelhaPlanilhaAposAplicar && !exclusoesBloqueadasAqui
    ? `     ✔ ESPELHA A PLANILHA após aplicar (banco = planilha no escopo)`
    : exclusoesBloqueadasAqui
      ? `     ✖ NÃO ESPELHA enquanto as exclusões estiverem BLOQUEADAS neste ambiente (${VARIAVEL_EXCLUSOES}≠1): sobrariam ${R(plano.removiveisCentavos)} que a planilha não tem. O plano espelharia se a exclusão fosse aprovada e liberada.`
      : `     ✖ NÃO ESPELHA A PLANILHA após aplicar: sobram ${R(plano.sobraAposAplicarCentavos)} que a planilha não tem (exclusões não aprovadas/bloqueadas)`);
  console.log(`     HASH DO PLANO: ${plano.hashPlano}`);
  if (detalhar) {
    for (const r of plano.removiveis) {
      const cand = r.candidatasNoMesmoDia.length ? ` → fonte no dia: ${r.candidatasNoMesmoDia.map((c) => `${c.chave.join(" | ") || "—"} ${R(c.centavos)}${c.mesmoValor ? " (mesmo valor)" : ""}`).join("; ")}` : " → sem registro da fonte nesse loja+dia";
      console.log(`       - ${r.id} ${r.data} ${r.unidade} ${r.chave.join(" | ") || "—"} ${R(r.centavos)}${cand}`);
    }
  }
}

/** `--corrigir <plano.json>`: simulação por padrão; só grava com `--confirmar`. Nunca importa planilhas. */
async function rodarCorrecao(args: Args): Promise<never> {
  const caminho = resolve(args.corrigir!);
  if (!existsSync(caminho)) { console.log(`⛔ plano não encontrado: ${caminho}`); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.log("⛔ DATABASE_URL não configurada (apps/web/.env.local)"); process.exit(1); }
  const bytesPlano = readFileSync(caminho);
  const shaPlano = createHash("sha256").update(bytesPlano).digest("hex");
  console.log(`SHA-256 do plano: ${shaPlano}`);
  if (args.confirmar && !exclusoesHabilitadas()) { console.log(`⛔ ${MOTIVO_EXCLUSOES_DESABILITADAS} — nada foi alterado`); process.exit(2); }
  if (args.confirmar && args.hashPlano !== shaPlano) { console.log("⛔ --confirmar exige --hash-plano <SHA-256 exibido na simulação> idêntico ao deste arquivo — nada foi alterado"); process.exit(2); }
  if (args.confirmar && !args.backupDir) { console.log("⛔ --confirmar exige --backup-dir <pasta> (o backup não vai para a pasta temporária) — nada foi alterado"); process.exit(2); }
  let plano: unknown;
  try { plano = JSON.parse(bytesPlano.toString("utf-8")); } catch { console.log("⛔ plano ilegível (JSON inválido) — nada foi alterado"); process.exit(1); }
  console.log(args.confirmar ? "MODO: GRAVAR CORREÇÃO (--confirmar)" : "MODO: SIMULAÇÃO DA CORREÇÃO (nada será gravado)", `| plano: ${caminho}`);
  const sql = postgres(process.env.DATABASE_URL, { ssl: sslPara(process.env.DATABASE_URL), max: 1 });
  let codigoSaida = 0;
  try {
    const gravarBackup = async (registros: RegistroBanco[]): Promise<string> => gravarBackupSeguro(args.backupDir ?? "", plano, registros);
    const r = await executarCorrecao(plano, bancoCorrecaoPg(sql), { confirmar: args.confirmar, gravarBackup });
    const mostrar = (t: string, s: SnapshotCorrecao) =>
      console.log(`  ${t}: ` + Object.entries(s.tabelas).map(([k, v]) => `${k} ${v.n}·${v.hash.slice(0, 8)}`).join(" | ") + ` | compra_direta sem alvos ${s.compraDiretaSemAlvos.n}·${s.compraDiretaSemAlvos.hash.slice(0, 8)}`);
    if (r.status === "plano-invalido" || r.status === "pre-condicao-falhou") {
      console.log(`\n⛔ ${r.status === "plano-invalido" ? "PLANO INVÁLIDO" : "PRÉ-CONDIÇÃO FALHOU"} — nada foi alterado:`);
      for (const e of r.erros) console.log("  -", e);
      codigoSaida = 2;
    } else if (r.status === "simulacao") {
      console.log("\nRegistros que SERIAM removidos (identificados por ID, pré-condições conferidas):");
      for (const x of r.registros) console.log(`  ${x.id} | ${x.unidade} ${x.data} ${x.motivo} ${formatarReais(Math.round(Number(x.valor) * 100))}`);
      console.log(`  total: ${formatarReais(r.removeriaCentavos)} em ${r.registros.length} registro(s)`);
      console.log("\nReferência (contagem · hash) ANTES:");
      mostrar("antes", r.antes);
      console.log(`\n${r.mensagem}`);
    } else if (r.status === "revertido") {
      console.log(`\n⛔ TRANSAÇÃO REVERTIDA (nada foi gravado): ${r.erro}`);
      codigoSaida = 1;
    } else if (r.status === "falha-pos-validacao") {
      console.log("\n⛔ GRAVADO, MAS A VALIDAÇÃO POSTERIOR FALHOU:");
      for (const e of r.erros) console.log("  -", e);
      console.log(`  backup: ${r.backup}`);
      codigoSaida = 1;
    } else {
      console.log(`\n✔ CORREÇÃO GRAVADA: ${r.removidos} registro(s), ${formatarReais(r.centavosRemovidos)} | backup completo: ${r.backup}`);
      mostrar("antes ", r.antes);
      mostrar("depois", r.depois);
    }
  } finally {
    await sql.end();
  }
  process.exit(codigoSaida);
}

/** `--restaurar <backup.json>`: desfaz uma sincronização a partir do backup gravado antes dela. Simulação por padrão; `--confirmar` grava. */
async function rodarRestauracao(args: Args): Promise<never> {
  const caminho = resolve(args.restaurar!);
  if (!existsSync(caminho)) { console.log(`⛔ backup não encontrado: ${caminho}`); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.log("⛔ DATABASE_URL não configurada (apps/web/.env.local)"); process.exit(1); }
  let conteudo: unknown;
  try { conteudo = JSON.parse(readFileSync(caminho, "utf-8")); } catch { console.log("⛔ backup ilegível (JSON inválido) — nada foi alterado"); process.exit(1); }
  console.log(args.confirmar ? "MODO: GRAVAR RESTAURAÇÃO (--confirmar)" : "MODO: SIMULAÇÃO DA RESTAURAÇÃO (nada será gravado)", `| backup: ${caminho}`);
  const sql = postgres(process.env.DATABASE_URL, { ssl: sslPara(process.env.DATABASE_URL), max: 1 });
  let codigo = 0;
  try {
    const r = await restaurarBackup(sql, conteudo, { confirmar: args.confirmar, removerNovos: args.removerNovos });
    const p = r.plano;
    console.log(`base: ${p.base} | reinserir (excluídos): ${p.reinserir} | devolver valor anterior: ${p.reverterValores} | remover inseridos pela sincronização: ${p.removerNovos}${p.removerNovosPedido ? "" : " (não pedido: use --remover-novos)"}`);
    for (const c of p.conflitos.slice(0, 20)) console.log("  ⚠ conflito:", c);
    if (r.status === "simulacao") console.log("\nSIMULAÇÃO: nada foi gravado. Para restaurar, repita com --confirmar.");
    else if (r.status === "bloqueado") { console.log(`\n⛔ BLOQUEADO — nada foi alterado: ${r.motivo}`); codigo = 2; }
    else if (r.status === "revertido") { console.log(`\n⛔ TRANSAÇÃO REVERTIDA — nada foi alterado: ${r.erro}`); codigo = 1; }
    else console.log("\n✔ RESTAURAÇÃO CONCLUÍDA e validada (registros idênticos aos do backup).");
  } catch (e) {
    console.log("⛔", e instanceof Error ? e.message : e);
    codigo = 1;
  } finally {
    await sql.end();
  }
  process.exit(codigo);
}

/**
 * Quebra de Caixa — relatório detalhado da simulação (somente leitura). Identificação por OCORRÊNCIA: chave oficial = chave natural
 * (loja+data+conferente+operador+cpf+motivo) + nº da ocorrência (posição por valor crescente dentro do grupo). Mostra lançamentos
 * aceitos/rejeitados com motivo, os posteriores ao ciclo da aba, as repetições preservadas, o impacto previsto no banco
 * (novos / existentes / alterados / só-no-banco), totais por data e por ciclo. Enquanto a migração 0004 não existir no banco, os
 * registros atuais são tratados como ocorrência 1 (é exatamente o que a migração faz). Retorna as pendências que exigem decisão.
 */
async function relatorioQuebra(s: Simulacao, detalhar: boolean): Promise<string[]> {
  const pendencias: string[] = [];
  if (!s.quebra || !s.registros) return pendencias;
  const R = (n: number) => formatarReais(Math.round(n * 100));
  const regs = s.registros;
  const rot = (r: (typeof regs)[number]) => `linha ${r.linhaOrigem}: ${dia(r.data)} ${r.unidade} ${R(r.valor)} | ${r.extras.operador ?? ""} | ${r.extras.motivo ?? ""} | ocorrência ${r.extras.ocorrencia ?? "1"}`;
  const somar = (xs: typeof regs) => xs.reduce((a, r) => a + r.valor, 0);

  console.log(`   ── QUEBRA DE CAIXA: aba "${s.quebra.aba.nomeAba}" (ciclo ${dia(s.quebra.aba.periodoInicio)} a ${dia(s.quebra.aba.periodoFim)}), critério: ${s.quebra.criterio === "ciclo" ? "referência dentro do ciclo da aba" : "cobertura estendida (referência no ciclo da última data lançada)"}`);
  for (const a of s.quebra.abasInvalidas) if (detalhar) console.log(`   ℹ aba descartada (não é Quebra válida): "${a.nomeAba}" — ${a.motivo}`);
  const ts = regs.map((r) => r.data.getTime());
  const dmin = dia(new Date(Math.min(...ts)));
  const dmax = dia(new Date(Math.max(...ts)));
  console.log(`   linhas VÁLIDAS (lançamentos): ${regs.length} | datas ${dmin} a ${dmax} | Σ planilha ${R(somar(regs))}`);
  const cls = resumirClasses("quebraCaixa", s.rejeicoes, aceitasDoRepositorio());
  const emBranco = cls["em-branco"];
  console.log(`   linhas REJEITADAS: ${s.rejeicoes.length} = VAZIAS ${emBranco.length} (sem loja/data/valor; linhas ${emBranco.length ? `${emBranco[0].linhaOrigem}…${emBranco[emBranco.length - 1].linhaOrigem}` : "—"}) + COM DADOS INVÁLIDOS ${s.rejeicoes.length - emBranco.length} (estruturais ${cls.estrutural.length}, já aceitas ${cls.aceita.length}, atenção ${cls.atencao.length})`);
  for (const r of [...cls.estrutural, ...cls.aceita, ...cls.atencao]) console.log(`   ✖ REJEITADO linha ${r.linhaOrigem}: ${r.motivo} | ${JSON.stringify(r.valoresBrutos ?? {}).slice(0, 160)}`);

  const posteriores = regs.filter((_, i) => s.quebra!.situacoes[i] === "posterior_ao_ciclo");
  console.log(`   lançamentos posteriores ao ciclo da aba (aceitos pela data real, sem deslocamento): ${posteriores.length}${posteriores.length ? ` | Σ ${R(somar(posteriores))}` : ""}`);
  for (const r of posteriores) console.log(`     • ${rot(r)}`);

  // chave natural antiga × ocorrências
  const grupos = new Map<string, typeof regs>();
  for (const r of regs) { const k = chaveNaturalQuebra(r); grupos.set(k, [...(grupos.get(k) ?? []), r]); }
  const repetidos = [...grupos.values()].filter((g) => g.length > 1);
  const linhasEmRepeticao = repetidos.reduce((a, g) => a + g.length, 0);
  console.log(`   CHAVE NATURAL ANTIGA: ${grupos.size} chaves distintas; ${grupos.size - repetidos.length} com 1 lançamento e ${repetidos.length} com repetição (${linhasEmRepeticao} lançamentos; o upsert antigo manteria só ${repetidos.length} deles, descartando ${linhasEmRepeticao - repetidos.length} lançamento(s))`);
  console.log(`   CHAVE OFICIAL NOVA (natural + ocorrência): ${new Set(regs.map(chaveOficialQuebra)).size} chaves únicas para ${regs.length} lançamentos — repetidas: ${chavesOficiaisRepetidas(regs).length}`);
  for (const g of repetidos) console.log(`     ${g[0].unidade} ${dia(g[0].data)} ${g[0].extras.operador ?? ""} / ${g[0].extras.motivo ?? ""}: ${[...g].sort((x, y) => Number(x.extras.ocorrencia) - Number(y.extras.ocorrencia)).map((r) => `ocorr.${r.extras.ocorrencia}=${R(r.valor)} (linha ${r.linhaOrigem})`).join(" | ")}`);
  if (chavesOficiaisRepetidas(regs).length) pendencias.push("quebraCaixa: ainda há chave oficial repetida após numerar as ocorrências — nada será gravado");

  // impacto no banco (somente leitura)
  if (!process.env.DATABASE_URL) { console.log("   (sem DATABASE_URL: impacto no banco não calculado)"); return pendencias; }
  const sql = postgres(process.env.DATABASE_URL, { ssl: sslPara(process.env.DATABASE_URL), max: 1 });
  try {
    const [col] = await sql.unsafe("select exists (select 1 from information_schema.columns where table_schema='public' and table_name='quebra_caixa' and column_name='ocorrencia') as e");
    const temColuna = Boolean(col.e);
    console.log(`   BANCO: migração 0004 (coluna ocorrencia) ${temColuna ? "JÁ aplicada" : "NÃO aplicada — registros atuais tratados como ocorrência 1 (é o que a migração fará); a GRAVAÇÃO está bloqueada até a migração"}`);
    const banco = await sql.unsafe(`select u.codigo, q.data::text d, q.conferente, q.operador, q.cpf, q.motivo, ${temColuna ? "q.ocorrencia::text" : "'1'"} oc, q.valor::numeric(14,2)::text v from quebra_caixa q join unidades u on u.id = q.unidade_id where q.data between $1::date and $2::date`, [dmin, dmax]);
    const mb = new Map<string, number>();
    for (const b of banco) mb.set(chaveOficialQuebra({ unidade: b.codigo as never, data: new Date(`${b.d}T00:00:00.000Z`), extras: { conferente: String(b.conferente).trim(), operador: String(b.operador).trim(), cpf: String(b.cpf).trim(), motivo: String(b.motivo).trim(), ocorrencia: String(b.oc) } }), Number(b.v));
    // alinha os números de ocorrência ao que já existe (a mesma lógica da gravação): preserva a identidade de cada ocorrência
    const alinhados = alinharOcorrenciasComExistentes(regs, banco.map((b) => ({
      chaveNatural: chaveNaturalQuebra({ unidade: b.codigo as never, data: new Date(`${b.d}T00:00:00.000Z`), extras: { conferente: String(b.conferente).trim(), operador: String(b.operador).trim(), cpf: String(b.cpf).trim(), motivo: String(b.motivo).trim() } }),
      ocorrencia: Number(b.oc),
      valor: Number(b.v),
    })));
    const novos: typeof regs = [];
    const alterados: { r: (typeof regs)[number]; antes: number }[] = [];
    let iguais = 0;
    const chavesArquivo = new Set<string>();
    for (const r of alinhados) {
      const k = chaveOficialQuebra(r);
      chavesArquivo.add(k);
      const b = mb.get(k);
      if (b === undefined) novos.push(r);
      else if (Math.abs(b - r.valor) > 0.004) alterados.push({ r, antes: b });
      else iguais++;
    }
    const soNoBanco = [...mb.keys()].filter((k) => !chavesArquivo.has(k));
    const somaBanco = banco.reduce((a, b) => a + Number(b.v), 0);
    const somaSoNoBanco = soNoBanco.reduce((a, k) => a + mb.get(k)!, 0);
    if (chavesOficiaisRepetidas(alinhados).length) pendencias.push("quebraCaixa: chave oficial repetida após alinhar com o banco — nada será gravado");
    const novosDeRepeticao = novos.filter((n) => [...mb.keys()].some((k) => k.startsWith(`${chaveNaturalQuebra(n)}|`)));
    console.log(`   IMPACTO PREVISTO NO BANCO (${dmin} a ${dmax}): banco hoje ${banco.length} registros (Σ ${R(somaBanco)}) | planilha ${regs.length} lançamentos | NOVOS ${novos.length} (Σ ${R(somar(novos))}) | EXISTENTES iguais ${iguais} | ATUALIZADOS ${alterados.length} | REMOVIDOS 0 (o fluxo oficial nunca exclui) | só no banco, preservados: ${soNoBanco.length} (Σ ${R(somaSoNoBanco)})`);
    console.log(`   recuperados por ocorrência (a chave natural já existia no banco; lançamento adicional): ${novosDeRepeticao.length} | Σ ${R(somar(novosDeRepeticao))}`);
    for (const r of novosDeRepeticao) console.log(`     + recuperado: ${rot(r)}`);
    for (const a of alterados) console.log(`     ~ atualizaria (valor): ${rot(a.r)} | banco ${R(a.antes)} → planilha ${R(a.r.valor)}  (NADA é sobrescrito nesta simulação)`);
    for (const k of soNoBanco) console.log(`     ! só no banco (preservado): ${k.split("|").slice(0, 6).join(" | ")} [ocorr. ${k.split("|")[6]}] = ${R(mb.get(k)!)}`);
    for (const r of novos.filter((x) => !novosDeRepeticao.includes(x))) if (detalhar || novos.length <= 40) console.log(`     + novo: ${rot(r)}`);
    const depois = somaBanco + somar(novos) + alterados.reduce((a, x) => a + (x.r.valor - x.antes), 0);
    const fecha = Math.abs(depois - somar(regs) - somaSoNoBanco) < 0.005;
    console.log(`   TOTAL PREVISTO DEPOIS (banco no intervalo): ${R(depois)} = planilha ${R(somar(regs))} + só-no-banco preservados ${R(somaSoNoBanco)} ${fecha ? "✔ (fecha)" : "✖ NÃO FECHA"}`);
    if (!fecha) pendencias.push("quebraCaixa: o total previsto depois da importação não fecha com planilha + só-no-banco");

    // totais por data (planilha × banco hoje × banco depois) e por ciclo
    const porDataPlan = new Map<string, number>(), porDataBanco = new Map<string, number>(), porDataDepois = new Map<string, number>();
    const acum = (m: Map<string, number>, d: string, v: number) => m.set(d, Math.round(((m.get(d) ?? 0) + v) * 100) / 100);
    for (const r of regs) acum(porDataPlan, dia(r.data), r.valor);
    for (const b of banco) { acum(porDataBanco, b.d as string, Number(b.v)); acum(porDataDepois, b.d as string, Number(b.v)); }
    for (const n of novos) acum(porDataDepois, dia(n.data), n.valor);
    for (const a of alterados) acum(porDataDepois, dia(a.r.data), a.r.valor - a.antes);
    const datas = [...new Set([...porDataPlan.keys(), ...porDataBanco.keys()])].sort();
    const mostrar = detalhar ? datas : datas.filter((d) => Math.abs((porDataPlan.get(d) ?? 0) - (porDataBanco.get(d) ?? 0)) > 0.004 || d >= "2026-10-09");
    console.log(`   TOTAIS POR DATA (planilha | banco hoje | banco depois)${detalhar ? "" : " — datas com diferença ou a partir de 09/10 (use --detalhar para todas)"}:`);
    for (const d of mostrar) { const p = porDataPlan.get(d) ?? 0, b = porDataBanco.get(d) ?? 0, dp = porDataDepois.get(d) ?? 0; console.log(`     ${d}  ${R(p).padStart(11)} | ${R(b).padStart(11)} | ${R(dp).padStart(11)}  ${Math.abs(p - dp) < 0.005 ? "= planilha" : `≠ planilha (diferença ${R(dp - p)}: só-no-banco preservado)`}`); }
    console.log(`   TOTAIS DO CICLO/INTERVALO: planilha ${R(somar(regs))} | banco hoje ${R(somaBanco)} | banco depois ${R(depois)}`);
  } finally { await sql.end(); }
  return pendencias;
}

async function main() {
  const args = lerArgs(process.argv.slice(2));
  for (const [n, v] of [["--de", args.de], ["--ate", args.ate]] as const) if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { console.log(`⛔ ${n} precisa estar no formato AAAA-MM-DD`); process.exit(1); }
  JANELA = { de: args.de, ate: args.ate };
  if (args.restaurar) return rodarRestauracao(args);
  if (args.corrigir) return rodarCorrecao(args);
  if (args.arquivos.length === 0) {
    console.log("Uso: npm run atualizar-bases -- <planilha.xlsx> [...] [--compra-direta-inicio AAAA-MM-DD --compra-direta-fim AAAA-MM-DD] [--gravar --plano plano.json] [--detalhar] [--corrigir plano.json [--confirmar] [--backup-dir pasta]] [--ref AAAA-MM-DD] [--de AAAA-MM-DD] [--ate AAAA-MM-DD] [--aceitar base,base]");
    process.exit(1);
  }
  const ref = new Date(`${args.ref}T00:00:00Z`);
  const aceitasRepo = aceitasDoRepositorio();
  console.log(args.gravar ? "MODO: GRAVAR" : "MODO: SIMULAÇÃO (nada será gravado)", `| referência: ${args.ref}`);

  // 1) identificar os arquivos
  const arquivos = new Map<string, File>();
  const shaPorArquivo = new Map<string, string>();
  const porBase = new Map<BaseId, string[]>();
  const bloqueios: string[] = [];
  console.log("\n== ARQUIVOS IDENTIFICADOS ==");
  for (const caminho of args.arquivos) {
    const nome = basename(caminho);
    if (!existsSync(caminho)) { bloqueios.push(`arquivo não encontrado: ${caminho}`); console.log(`⛔ ${nome}: não encontrado`); continue; }
    const file = new File([readFileSync(caminho)], nome);
    arquivos.set(nome, file);
    shaPorArquivo.set(nome, createHash("sha256").update(readFileSync(caminho)).digest("hex"));
    const pl = await lerArquivoExcel(file);
    const id = identificarBase({ nomeArquivo: nome, abas: Object.keys(pl.sheets), cabecalhoPrimeiraAba: pl.sheets[pl.primeiraAba]?.[0] ?? [] });
    if (id.status !== "ok") { bloqueios.push(`${nome}: ${id.status} — ${id.motivo}`); console.log(`⛔ ${nome}: ${id.status.toUpperCase()} — ${id.motivo}`); continue; }
    console.log(`✔ ${nome} → ${id.bases.join(" + ")} (${id.motivo})`);
    for (const b of id.bases) porBase.set(b, [...(porBase.get(b) ?? []), nome]);
  }
  for (const [b, nomes] of porBase) if (nomes.length > 1) bloqueios.push(`mais de um arquivo para ${b}: ${nomes.join("; ")} — informe qual usar`);

  // 2) simular todas as bases identificadas
  const bases = ORDEM.filter((b) => porBase.has(b) && (args.somente.length === 0 || args.somente.includes(b)));
  if (args.somente.length) console.log(`(restrito às bases: ${bases.join(", ") || "nenhuma"} — as demais bases do arquivo NÃO foram simuladas nem serão gravadas)`);
  const sims: Simulacao[] = [];
  const planos = new Map<BaseId, PlanoSincronizacao>();
  const opcoesPorBase = new Map<BaseId, OpcoesPlano>();
  const shaPorBase = new Map<BaseId, string>();
  console.log("\n== SIMULAÇÃO (parsers e regras oficiais) ==");
  for (const b of bases) {
    const nome = porBase.get(b)![0];
    const s = await simular(b, nome, arquivos.get(nome)!, ref);
    sims.push(s);
    shaPorBase.set(b, shaPorArquivo.get(nome) ?? "");
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
    if (b === "quebraCaixa") bloqueios.push(...(await relatorioQuebra(s, args.detalhar)));
    if (baseSnapshot(b) && s.registros && process.env.DATABASE_URL) {
      const leitura = postgres(process.env.DATABASE_URL, { ssl: sslPara(process.env.DATABASE_URL), max: 1 });
      try {
        const opcoes = opcoesDaBase(args, b, shaPorBase.get(b));
        opcoesPorBase.set(b, opcoes);
        const plano = await planejarNoBanco(leitura, b, s.registros, opcoes);
        planos.set(b, plano);
        imprimirPlano(plano, args.detalhar);
        if (!plano.podeGravar && !args.semExclusao.includes(b)) {
          bloqueios.push(`${b}: a sincronização está bloqueada pelos riscos acima (${plano.riscos.filter((r) => r.gravidade !== "aviso").map((r) => r.codigo).join(", ")}); corrija ou use --sem-exclusao ${b} para gravar somente novos/alterados`);
        } else if (plano.removiveis.length > 0 && !args.semExclusao.includes(b) && args.aprovarExclusoes[b] !== plano.hashPlano) {
          bloqueios.push(`${b}: ${plano.removiveis.length} registro(s) só no banco (${formatarReais(plano.removiveisCentavos)}) aguardam SUA aprovação: --aprovar-exclusoes ${b}=${plano.hashPlano}${exclusoesHabilitadas() ? "" : ` (e ${VARIAVEL_EXCLUSOES}=1 — hoje BLOQUEADO)`} (ou --sem-exclusao ${b})`);
        }
      } catch (e) {
        bloqueios.push(`${b}: sincronização não verificada (${e instanceof Error ? e.message : e}) — nada será gravado`);
      } finally {
        await leitura.end();
      }
    }
  }

  const planoPath = args.plano ?? join(tmpdir(), "atualizar-bases-plano.json");
  if (!args.gravar) {
    writeFileSync(planoPath, JSON.stringify({
      ref: args.ref,
      bases: Object.fromEntries(sims.map((s) => [s.base, {
        arquivo: s.arquivo,
        validos: s.validos,
        rejeitados: s.rejeitados,
        ...(planos.has(s.base) ? { hashPlano: planos.get(s.base)!.hashPlano } : {}),
      }]))
    }, null, 1));
    console.log(`\nplano da simulação salvo em: ${planoPath}`);
    if (bloqueios.length) { console.log("\n⛔ PENDÊNCIAS (nada foi gravado):"); for (const b of bloqueios) console.log("  -", b); process.exit(2); }
    console.log("\nSIMULAÇÃO concluída: tudo validado, nada foi gravado.");
    process.exit(0);
  }

  // 3) gravação: só com tudo validado
  if (bloqueios.length) { console.log("\n⛔ NÃO GRAVADO — pendências:"); for (const b of bloqueios) console.log("  -", b); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.log("⛔ DATABASE_URL não configurada (apps/web/.env.local)"); process.exit(1); }
  const plano = args.plano && existsSync(args.plano) ? (JSON.parse(readFileSync(args.plano, "utf-8")) as { bases: Record<string, { validos: number; rejeitados: number; hashPlano?: string }> }) : null;
  if (plano) for (const s of sims) {
    const p = plano.bases[s.base];
    if (!p || p.validos !== s.validos || p.rejeitados !== s.rejeitados) { console.log(`⛔ ${s.base}: a nova simulação (${s.validos}/${s.rejeitados}) difere do plano (${p ? `${p.validos}/${p.rejeitados}` : "ausente"}) — NADA gravado`); process.exit(1); }
    if (planos.has(s.base) && p.hashPlano !== planos.get(s.base)!.hashPlano) { console.log(`⛔ ${s.base}: o plano atual (${planos.get(s.base)!.hashPlano.slice(0, 12)}…) difere do plano simulado (${(p.hashPlano ?? "ausente").slice(0, 12)}…) — o banco, o arquivo ou as opções mudaram; refaça a simulação. NADA gravado`); process.exit(1); }
  }

  const sql = postgres(process.env.DATABASE_URL, { ssl: sslPara(process.env.DATABASE_URL), max: 1 });
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
    let inseridos = 0;
    let atualizados = 0;
    let removidos = 0;
    let rejeitados = s.rejeitados;
    let detalhes: { inseridos: number; atualizados: number; rejeitados: number; erro?: string } | undefined;
    let sufixo = "";

    if (baseSnapshot(s.base) && s.registros) {
      const g = await sincronizarBase(sql, s.base, s.registros, {
        ...(opcoesPorBase.get(s.base) ?? opcoesDaBase(args, s.base, shaPorBase.get(s.base))),
        confirmar: true,
        hashPlanoAprovado: args.aprovarExclusoes[s.base],
        gravarBackup: args.backupDir ? async (c) => gravarBackupSincronizacao(args.backupDir!, c) : undefined,
      });
      if (g.status === "bloqueado") return parar(`${s.base}: ${g.motivo}`);
      if (g.status === "revertido") return parar(`${s.base}: transação REVERTIDA — nada foi gravado: ${g.erro}`);
      if (g.status !== "gravado") return parar(`${s.base}: resultado inesperado (${g.status})`);
      inseridos = g.inseridos;
      atualizados = g.atualizados;
      removidos = g.removidos;
      sufixo = ` | Σ banco no escopo ${formatarReais(g.totalNoEscopoDepois.centavos)} = fonte${g.plano.removiveis.length && !g.removidos ? " + só-no-banco preservados" : ""} ✔${g.backup ? ` | backup: ${g.backup}` : ""}`;
      if (s.base === "cancelamentoSalao") {
        // os detalhes individuais dos estornos continuam pelo fluxo oficial (idempotente, em lotes); o agregado já foi sincronizado acima
        let insD = 0;
        let atuD = 0;
        const regs = s.detalhesCS ?? [];
        for (let i = 0; i < regs.length; i += 800) {
          const rd = await persistirDetalhesCancelamentoSalao(regs.slice(i, i + 800));
          insD += rd?.inseridos ?? 0;
          atuD += rd?.atualizados ?? 0;
        }
        detalhes = { inseridos: insD, atualizados: atuD, rejeitados: 0 };
      }
    } else {
      const r = await processarArquivoBase(s.base, arquivos.get(s.arquivo)!, [], ref);
      if (r.status === "erro") return parar(`${s.base}: ${r.mensagem}`);
      inseridos = r.inseridos;
      atualizados = r.atualizados;
      rejeitados = r.rejeitados;
      detalhes = r.detalhes;
    }

    const depois = (await snapshot(sql, [tab]))[tab];
    const esperado = antes.n + inseridos - removidos;
    let linha = `  inseridos ${inseridos} | atualizados ${atualizados} | removidos ${removidos} | rejeitados ${rejeitados} | tabela ${antes.n} → ${depois.n} (esperado ${esperado}) ${depois.n === esperado ? "✔" : "⚠ DIVERGE"}${sufixo}`;
    if (rejeitados !== s.rejeitados) { console.log(linha); await parar(`${s.base}: rejeitados diferentes da simulação (${rejeitados} × ${s.rejeitados})`); }
    if (depois.n !== esperado) { console.log(linha); await parar(`contagem divergente em ${s.base}`); }
    if (detAntes) {
      const det = (await snapshot(sql, ["cancelamento_salao_detalhe"])).cancelamento_salao_detalhe;
      linha += ` | detalhes: ${detalhes ? `+${detalhes.inseridos} novos, ${detalhes.atualizados} atualizados` : "sem retorno"} (${detAntes.n} → ${det.n})`;
      console.log(linha);
      if (detalhes?.erro) await parar(`erro nos detalhes: ${detalhes.erro}`);
      if (det.n !== detAntes.n + (detalhes?.inseridos ?? 0)) await parar("contagem de detalhes divergente");
    } else console.log(linha);
    relatorio.push(`${s.base.padEnd(21)} ${s.validos} válidos | ${rejeitados} rej. | +${inseridos} novos | ${atualizados} atualizados | -${removidos} removidos | ${antes.n} → ${depois.n}${depois.hash === antes.hash ? " | conteúdo IDÊNTICO" : ""}`);
  }

  const final = await snapshot(sql, tabelas);
  console.log("\n== ESTADO FINAL × REFERÊNCIA INICIAL ==");
  for (const t of tabelas) console.log(`  ${t.padEnd(28)} ${String(inicial[t].n).padStart(6)} → ${String(final[t].n).padStart(6)} (${final[t].n - inicial[t].n >= 0 ? "+" : ""}${final[t].n - inicial[t].n}) | conteúdo ${inicial[t].hash === final[t].hash ? "IDÊNTICO" : "alterado"}`);
  console.log("\n== RELATÓRIO POR BASE ==");
  for (const l of relatorio) console.log("  " + l);
  await sql.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERRO:", e instanceof Error ? e.message : e); process.exit(1); });
