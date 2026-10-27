/**
 * Backup VERIFICÁVEL antes de gravar bases ("atualizar base"). SOMENTE LEITURA no banco: lê as tabelas dentro de UMA transação
 * `REPEATABLE READ READ ONLY` (visão consistente) e grava arquivos locais; nunca escreve no banco.
 *
 *   npm run backup-pre-gravacao                                 → backup das 13 tabelas padrão em <BASE DE DADOS - POWERBI>\BACKUPS_SINCRONIZACAO\AAAA-MM-DD_pre-gravacao[-n]
 *   npm run backup-pre-gravacao -- --destino <pasta>            → pasta escolhida (deve não existir ou estar vazia; NUNCA sobrescreve)
 *   npm run backup-pre-gravacao -- --tabelas brindes,faturamento → só essas tabelas (precisam estar na lista padrão)
 *   npm run backup-pre-gravacao -- --verificar <pasta>          → reconfere um backup existente (SHA-256 e nº de linhas de cada arquivo × MANIFESTO.json)
 *
 * Cada tabela vira `<tabela>.jsonl` (uma linha JSON por registro, ordenado por id). O `MANIFESTO.json` guarda, por tabela: linhas no arquivo,
 * linhas no banco (mesma transação), Σ valor (quando a tabela tem a coluna), SHA-256 e se está conferido. Saída ≠ 0 se algo divergir.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

export const TABELAS_PADRAO = [
  "brindes",
  "cancelamento_salao",
  "cancelamento_salao_detalhe",
  "cancelamento_delivery",
  "compra_direta",
  "retirada_deposito",
  "faturamento",
  "formas_pagamento",
  "quebra_caixa",
  "conferencia",
  "fechamento_caixa",
  "troco",
  "pdv_maquininha",
] as const;

export interface LeituraTabela {
  linhas: Record<string, unknown>[];
  /** Contagem informada pelo banco (na mesma transação da leitura). */
  contagem: number;
  /** Σ da coluna `valor` (texto, sem arredondar) ou null se a tabela não tem a coluna. */
  somaValor: string | null;
}
export interface FonteBackup {
  lerTabela(tabela: string): Promise<LeituraTabela>;
}

export interface EntradaTabela {
  linhasNoArquivo: number;
  linhasNoBanco: number;
  somaValor: string | null;
  sha256: string;
  conferido: boolean;
}
export interface Manifesto {
  quando: string;
  tabelas: Record<string, EntradaTabela>;
}
export interface ResultadoBackup {
  ok: boolean;
  destino: string;
  manifesto: Manifesto;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const contarLinhas = (b: Buffer) => b.toString("utf-8").split("\n").filter((l) => l.length > 0).length;

/** Gera o backup (arquivos + MANIFESTO.json), relê cada arquivo gravado e confere com o banco. Nunca sobrescreve uma pasta com conteúdo. */
export async function gerarBackup(fonte: FonteBackup, opcoes: { destino: string; tabelas?: readonly string[]; agora?: Date }): Promise<ResultadoBackup> {
  const tabelas = [...(opcoes.tabelas ?? TABELAS_PADRAO)];
  const invalidas = tabelas.filter((t) => !(TABELAS_PADRAO as readonly string[]).includes(t));
  if (invalidas.length > 0) throw new Error(`tabela(s) fora da lista permitida: ${invalidas.join(", ")}`);
  if (tabelas.length === 0) throw new Error("nenhuma tabela informada");
  const destino = resolve(opcoes.destino);
  if (existsSync(destino) && readdirSync(destino).length > 0) throw new Error(`a pasta de destino já tem conteúdo e não será sobrescrita: ${destino}`);
  mkdirSync(destino, { recursive: true });

  const manifesto: Manifesto = { quando: (opcoes.agora ?? new Date()).toISOString(), tabelas: {} };
  for (const t of tabelas) {
    const leitura = await fonte.lerTabela(t);
    const arquivo = join(destino, `${t}.jsonl`);
    writeFileSync(arquivo, leitura.linhas.map((l) => JSON.stringify(l)).join("\n") + (leitura.linhas.length > 0 ? "\n" : ""));
    const lido = readFileSync(arquivo); // relê o que foi gravado em disco
    const linhasNoArquivo = contarLinhas(lido);
    manifesto.tabelas[t] = {
      linhasNoArquivo,
      linhasNoBanco: leitura.contagem,
      somaValor: leitura.somaValor,
      sha256: sha256(lido),
      conferido: linhasNoArquivo === leitura.contagem && leitura.linhas.length === leitura.contagem,
    };
  }
  writeFileSync(join(destino, "MANIFESTO.json"), JSON.stringify(manifesto, null, 1));
  return { ok: Object.values(manifesto.tabelas).every((e) => e.conferido), destino, manifesto };
}

/** Reconfere um backup já existente: arquivo presente, SHA-256 e nº de linhas iguais ao MANIFESTO. Só leitura. */
export function verificarBackup(pasta: string): { ok: boolean; problemas: string[]; manifesto: Manifesto | null } {
  const dir = resolve(pasta);
  const caminho = join(dir, "MANIFESTO.json");
  if (!existsSync(caminho)) return { ok: false, problemas: [`MANIFESTO.json não encontrado em ${dir}`], manifesto: null };
  let manifesto: Manifesto;
  try {
    manifesto = JSON.parse(readFileSync(caminho, "utf-8")) as Manifesto;
  } catch {
    return { ok: false, problemas: ["MANIFESTO.json ilegível"], manifesto: null };
  }
  const problemas: string[] = [];
  for (const [t, e] of Object.entries(manifesto.tabelas ?? {})) {
    const arq = join(dir, `${t}.jsonl`);
    if (!existsSync(arq)) { problemas.push(`${t}: arquivo ausente`); continue; }
    const lido = readFileSync(arq);
    if (sha256(lido) !== e.sha256) problemas.push(`${t}: SHA-256 diferente do manifesto (arquivo alterado ou corrompido)`);
    if (contarLinhas(lido) !== e.linhasNoArquivo) problemas.push(`${t}: ${contarLinhas(lido)} linhas no arquivo, manifesto diz ${e.linhasNoArquivo}`);
    if (!e.conferido) problemas.push(`${t}: o backup foi gravado SEM conferência com o banco (${e.linhasNoArquivo} × ${e.linhasNoBanco})`);
  }
  if (Object.keys(manifesto.tabelas ?? {}).length === 0) problemas.push("manifesto sem tabelas");
  return { ok: problemas.length === 0, problemas, manifesto };
}

/** Fonte real: PostgreSQL (somente SELECT). Só aceita nomes da lista padrão. */
export function fontePostgres(q: postgres.Sql | postgres.TransactionSql): FonteBackup {
  const sql = q as postgres.Sql;
  return {
    async lerTabela(tabela) {
      if (!(TABELAS_PADRAO as readonly string[]).includes(tabela)) throw new Error(`tabela não permitida: ${tabela}`);
      const linhas = (await sql.unsafe(`select to_jsonb(x) as j from ${tabela} x order by x.id`)).map((r) => r.j as Record<string, unknown>);
      const [{ n }] = await sql.unsafe(`select count(*)::int as n from ${tabela}`);
      const [col] = await sql.unsafe(`select 1 as ok from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = 'valor'`, [tabela]);
      const somaValor = col ? String((await sql.unsafe(`select coalesce(sum(valor), 0)::text as s from ${tabela}`))[0].s) : null;
      return { linhas, contagem: Number(n), somaValor };
    },
  };
}

/** Lê tudo dentro de UMA transação de leitura (visão consistente entre as tabelas). */
export async function gerarBackupPg(sql: postgres.Sql, opcoes: { destino: string; tabelas?: readonly string[] }): Promise<ResultadoBackup> {
  return (await sql.begin("isolation level repeatable read read only", (tx) => gerarBackup(fontePostgres(tx), opcoes))) as ResultadoBackup;
}

// ───────────────────────── linha de comando ─────────────────────────

const hojeBrasil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sslPara = (url: string): "require" | false => (/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(url) ? false : "require");

/** Pasta padrão: <BASE DE DADOS - POWERBI>\BACKUPS_SINCRONIZACAO\AAAA-MM-DD_pre-gravacao[-n] (a partir de apps/web). */
export function destinoPadrao(base = resolve(process.cwd(), "..", "..", "..", "BACKUPS_SINCRONIZACAO"), data = hojeBrasil()): string {
  let n = 1;
  let dir = join(base, `${data}_pre-gravacao`);
  while (existsSync(dir)) dir = join(base, `${data}_pre-gravacao-${++n}`);
  return dir;
}

async function main(argv: string[]): Promise<number> {
  let destino: string | undefined;
  let tabelas: string[] | undefined;
  let verificar: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--destino") destino = argv[++i];
    else if (argv[i] === "--tabelas") tabelas = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--verificar") verificar = argv[++i];
    else { console.log(`argumento desconhecido: ${argv[i]}`); return 1; }
  }
  if (verificar) {
    const v = verificarBackup(verificar);
    for (const [t, e] of Object.entries(v.manifesto?.tabelas ?? {})) console.log(`  ${t.padEnd(28)} ${String(e.linhasNoArquivo).padStart(6)} linhas | ${e.sha256.slice(0, 12)}`);
    if (!v.ok) { console.log("BACKUP_INVALIDO:"); for (const p of v.problemas) console.log("  -", p); return 2; }
    console.log(`BACKUP_VERIFICADO ${resolve(verificar)}`);
    return 0;
  }
  if (!process.env.DATABASE_URL) { console.log("⛔ DATABASE_URL não configurada (apps/web/.env.local)"); return 1; }
  const alvo = destino ?? destinoPadrao();
  const sql = postgres(process.env.DATABASE_URL, { ssl: sslPara(process.env.DATABASE_URL), max: 1, onnotice: () => {} });
  try {
    const r = await gerarBackupPg(sql, { destino: alvo, tabelas });
    for (const [t, e] of Object.entries(r.manifesto.tabelas)) {
      console.log(`  ${t.padEnd(28)} ${String(e.linhasNoArquivo).padStart(6)} linhas | banco ${String(e.linhasNoBanco).padStart(6)} | Σ ${e.somaValor ?? "—"} | ${e.sha256.slice(0, 12)} | ${e.conferido ? "ok" : "DIVERGE"}`);
    }
    const v = verificarBackup(r.destino); // segunda conferência, só a partir do que está em disco
    if (!r.ok || !v.ok) { console.log("BACKUP_COM_DIVERGENCIA:"); for (const p of v.problemas) console.log("  -", p); return 2; }
    console.log(`BACKUP_OK ${r.destino}`);
    return 0;
  } catch (e) {
    console.log("⛔ backup NÃO concluído:", e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
