import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gerarBackupPg, verificarBackup } from "../../scripts/backup-pre-gravacao";

/**
 * Backup pré-gravação em PostgreSQL REAL, LOCAL e DESCARTÁVEL (PG_TESTE_URL → 127.0.0.1/descartavel). Dados 100% sintéticos.
 * Recusa qualquer outro destino (Supabase, produção, banco compartilhado). Prova que o backup é SOMENTE LEITURA.
 */
const URL_TESTE = process.env.PG_TESTE_URL ?? "";
let sql: postgres.Sql;
const dirs: string[] = [];
const novoDir = () => { const d = mkdtempSync(join(tmpdir(), "bkp-pg-")); dirs.push(d); return d; };

describe.skipIf(!URL_TESTE)("backup pré-gravação (PostgreSQL local descartável)", () => {
  beforeAll(async () => {
    const u = new URL(URL_TESTE);
    expect(["127.0.0.1", "localhost"]).toContain(u.hostname);
    expect(URL_TESTE).not.toMatch(/supabase|pooler|amazonaws|neon\.tech/i);
    expect(URL_TESTE).not.toBe(process.env.DATABASE_URL ?? "__sem__");
    expect(u.pathname).toBe("/descartavel");
    sql = postgres(URL_TESTE, { max: 1, ssl: false, onnotice: () => {} });
    await sql.unsafe("drop schema public cascade; create schema public;");
    await sql.unsafe("create table brindes (id uuid primary key default gen_random_uuid(), motivo text, valor numeric(14,2) not null)");
    await sql.unsafe("create table troco (id uuid primary key default gen_random_uuid(), caixa text, diferenca numeric(14,2))");
    await sql.unsafe("insert into brindes (motivo, valor) values ('A', 10.50), ('B', 5.25), ('C', 0.25)");
    await sql.unsafe("insert into troco (caixa, diferenca) values ('PDV 01', -1.5), ('PDV 02', 0)");
  });
  afterAll(async () => {
    await sql?.end();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("copia as tabelas, confere arquivo × banco (mesma transação), calcula Σ valor e NÃO altera o banco", async () => {
    const antes = await sql.unsafe("select (select count(*) from brindes)::int b, (select sum(valor) from brindes)::text s, (select count(*) from troco)::int t");
    const dir = join(novoDir(), "bk");
    const r = await gerarBackupPg(sql, { destino: dir, tabelas: ["brindes", "troco"] });
    expect(r.ok).toBe(true);
    expect(r.manifesto.tabelas.brindes).toMatchObject({ linhasNoArquivo: 3, linhasNoBanco: 3, somaValor: "16.00", conferido: true });
    expect(r.manifesto.tabelas.troco).toMatchObject({ linhasNoArquivo: 2, linhasNoBanco: 2, somaValor: null, conferido: true });
    expect(readFileSync(join(dir, "brindes.jsonl"), "utf-8").trim().split("\n")).toHaveLength(3);
    expect(verificarBackup(dir).ok).toBe(true);
    const depois = await sql.unsafe("select (select count(*) from brindes)::int b, (select sum(valor) from brindes)::text s, (select count(*) from troco)::int t");
    expect(depois[0]).toEqual(antes[0]); // somente leitura
  });

  it("a transação do backup é somente leitura (uma escrita dentro dela seria recusada pelo PostgreSQL)", async () => {
    await expect(sql.begin("isolation level repeatable read read only", (tx) => tx.unsafe("insert into brindes (motivo, valor) values ('X', 1)"))).rejects.toThrow(/read-only/i);
    expect((await sql.unsafe("select count(*)::int n from brindes"))[0].n).toBe(3);
  });

  it("linha de comando: gera o backup na pasta indicada, imprime BACKUP_OK e depois --verificar confirma", () => {
    const dir = join(novoDir(), "cli");
    const env = { ...process.env, DATABASE_URL: URL_TESTE };
    const raiz = resolve(".");
    const r = spawnSync("node", ["--import", "tsx", "scripts/backup-pre-gravacao.ts", "--destino", dir, "--tabelas", "brindes,troco"], { cwd: raiz, env, encoding: "utf-8", shell: true });
    expect(r.stdout).toContain("BACKUP_OK");
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, "MANIFESTO.json"))).toBe(true);
    const v = spawnSync("node", ["--import", "tsx", "scripts/backup-pre-gravacao.ts", "--verificar", dir], { cwd: raiz, env, encoding: "utf-8", shell: true });
    expect(v.stdout).toContain("BACKUP_VERIFICADO");
    expect(v.status).toBe(0);
    // pasta já usada: recusa (exit ≠ 0) e não sobrescreve
    const de_novo = spawnSync("node", ["--import", "tsx", "scripts/backup-pre-gravacao.ts", "--destino", dir, "--tabelas", "brindes"], { cwd: raiz, env, encoding: "utf-8", shell: true });
    expect(de_novo.status).not.toBe(0);
    expect(de_novo.stdout).toMatch(/não será sobrescrita/);
  });
});
