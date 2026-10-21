import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compactarLote } from "@/lib/import/loteCompacto";
import { restaurarBackup } from "@/lib/import/restauracaoBackupPg";
import type { RegistroBase } from "@/lib/import/tipos";

/**
 * "Base mestre": o arquivo é a base histórica COMPLETA; ao confirmar, o banco deve espelhar a planilha no escopo (sem duplicar e sem manter
 * o que não existe mais na fonte) e a exclusão deve ser RECUPERÁVEL pelo backup. PostgreSQL LOCAL e DESCARTÁVEL (PG_TESTE_URL → 127.0.0.1/descartavel).
 */
const URL_TESTE = process.env.PG_TESTE_URL ?? "";
let sql: postgres.Sql;
let acoes: typeof import("@/lib/actions/sincronizacaoBases");
let backupDir = "";
const dirs: string[] = [];
const novoDir = () => { const d = mkdtempSync(join(tmpdir(), "espelho-")); dirs.push(d); return d; };

async function recriar() {
  await sql.unsafe("drop schema public cascade; create schema public;");
  await sql.unsafe("create table unidades (id uuid primary key default gen_random_uuid(), codigo text unique not null, nome text)");
  await sql.unsafe(`create table brindes (id uuid primary key default gen_random_uuid(), unidade_id uuid not null references unidades(id), data date not null, importacao_id uuid,
    criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(), motivo text not null, motivo2 text not null default '', valor numeric(14,2) not null, quantidade numeric(12,2),
    unique (unidade_id, data, motivo, motivo2))`);
  await sql.unsafe("insert into unidades (codigo, nome) values ('BG 01','BG 01'),('BG 02','BG 02')");
}
const ins = async (u: string, d: string, m: string, m2: string, v: string) =>
  (await sql`insert into brindes (unidade_id, data, motivo, motivo2, valor) select id, ${d}::date, ${m}, ${m2}, ${v}::numeric from unidades where codigo = ${u} returning id::text`)[0].id as string;
const reg = (u: string, d: string, m: string, m2: string, v: number): RegistroBase => ({ unidade: u as RegistroBase["unidade"], data: new Date(`${d}T00:00:00.000Z`), valor: v, extras: { motivo: m, motivo2: m2 }, linhaOrigem: 0 });
const tabelaCompleta = async () => (await sql.unsafe("select md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) h, count(*)::int n, coalesce(sum(valor),0)::text s from brindes x"))[0] as unknown as { h: string; n: number; s: string };
const escopoRows = async () => (await sql`select u.codigo, x.data::text d, x.motivo, x.motivo2, x.valor::text v from brindes x join unidades u on u.id = x.unidade_id where x.data between date '2026-06-01' and date '2026-06-30' and u.codigo = 'BG 01' order by 2,3,4`) as unknown as Array<{ codigo: string; d: string; motivo: string; motivo2: string; v: string }>;

/** Estado do banco ANTES: a planilha mestre mudou desde a última importação. */
async function cenario() {
  await recriar();
  await ins("BG 01", "2026-06-01", "BRINDE PRESENTE", "DESCONTO", "10.00"); // submotivo renomeado na fonte
  await ins("BG 01", "2026-06-02", "BRINDE TAXA EXTRA", "ERRO TAON", "5.00"); // submotivo renomeado
  await ins("BG 01", "2026-06-03", "BRINDE ANIVERSARIANTE", "", "20.00"); // valor mudou
  await ins("BG 01", "2026-06-04", "BRINDE PRESENTE", "BRINDE GERENCIA", "7.00"); // linha removida da fonte (outras linhas no dia)
  await ins("BG 01", "2026-06-04", "BRINDE PRESENTE", "ERRO", "3.00"); // continua igual
  await ins("BG 01", "2026-05-20", "HISTORICO", "", "99.00"); // ANTES do período do arquivo → preservado
  await ins("BG 02", "2026-06-02", "OUTRA LOJA", "", "50.00"); // loja que o arquivo NÃO traz ... (ver cenário "loja ausente")
  // a planilha mestre completa (somente BG 01):
  return [
    reg("BG 01", "2026-06-01", "BRINDE PRESENTE", "DESCONTO VENCIMENTO", 10),
    reg("BG 01", "2026-06-02", "BRINDE TAXA EXTRA", "ERRO ENTREGADOR", 5),
    reg("BG 01", "2026-06-03", "BRINDE ANIVERSARIANTE", "", 25),
    reg("BG 01", "2026-06-04", "BRINDE PRESENTE", "ERRO", 3),
    reg("BG 01", "2026-06-05", "BRINDE NOVO", "", 8.5),
  ];
}

describe.skipIf(!URL_TESTE)("base mestre: espelho da planilha e exclusão recuperável — PostgreSQL LOCAL descartável", () => {
  beforeAll(async () => {
    const u = new URL(URL_TESTE);
    expect(["127.0.0.1", "localhost"]).toContain(u.hostname);
    expect(URL_TESTE).not.toMatch(/supabase|pooler|amazonaws|neon\.tech/i);
    expect(URL_TESTE).not.toBe(process.env.DATABASE_URL ?? "__sem__");
    expect(u.pathname).toBe("/descartavel");
    process.env.DATABASE_URL = URL_TESTE;
    backupDir = novoDir();
    process.env.SINCRONIZACAO_BACKUP_DIR = backupDir;
    process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = "1";
    sql = postgres(URL_TESTE, { max: 1, ssl: false, onnotice: () => {} });
    acoes = await import("@/lib/actions/sincronizacaoBases");
  });
  afterAll(async () => {
    await sql?.end();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  const previa = (fonte: RegistroBase[], opcoes = {}) => acoes.previsualizarSincronizacaoBase({ base: "brindes", registros: compactarLote("brindes", fonte), opcoes });
  const confirmar = (fonte: RegistroBase[], hash: string, extra = {}) => acoes.confirmarSincronizacaoBase({ base: "brindes", registros: compactarLote("brindes", fonte), hashPlanoAprovado: hash, ...extra });

  it("o botão Atualizar base espelha a planilha: novos entram, alterados mudam, motivo/submotivo renomeado NÃO acumula, o que sumiu da fonte sai e o histórico fora do escopo é preservado", async () => {
    const fonte = await cenario();
    await sql`delete from brindes where unidade_id = (select id from unidades where codigo = 'BG 02')`; // este cenário traz só a loja BG 01 (cobertura completa)
    const p = await previa(fonte);
    if (!p.conectado) throw new Error("sem banco");
    expect([p.plano.novosTotal, p.plano.iguais, p.plano.alteradosTotal, p.plano.removiveisTotal]).toEqual([3, 1, 1, 3]);
    expect(p.plano.espelhaPlanilhaAposAplicar).toBe(true);
    expect(p.plano.removiveis.map((r) => r.chave.join("|")).sort()).toEqual(["BRINDE PRESENTE|BRINDE GERENCIA", "BRINDE PRESENTE|DESCONTO", "BRINDE TAXA EXTRA|ERRO TAON"]);

    const r = await confirmar(fonte, p.plano.hashPlano, { confirmacaoExclusao: "EXCLUIR 3" });
    expect(r.status).toBe("gravado");
    if (r.status !== "gravado") return;
    expect([r.inseridos, r.atualizados, r.removidos]).toEqual([3, 1, 3]);

    // o escopo do banco é EXATAMENTE a planilha (chaves e valores), sem sobras e sem duplicar
    const dentro = await escopoRows();
    expect(dentro.map((x) => `${x.d}|${x.motivo}|${x.motivo2}|${x.v}`)).toEqual([
      "2026-06-01|BRINDE PRESENTE|DESCONTO VENCIMENTO|10.00",
      "2026-06-02|BRINDE TAXA EXTRA|ERRO ENTREGADOR|5.00",
      "2026-06-03|BRINDE ANIVERSARIANTE||25.00",
      "2026-06-04|BRINDE PRESENTE|ERRO|3.00",
      "2026-06-05|BRINDE NOVO||8.50",
    ]);
    expect(dentro.reduce((s, x) => s + Number(x.v), 0)).toBeCloseTo(fonte.reduce((s, x) => s + x.valor, 0), 2);
    // histórico anterior ao período do arquivo preservado
    expect((await sql`select valor::text v from brindes where motivo = 'HISTORICO'`)[0].v).toBe("99.00");
    // reexecutar não muda nada (idempotente, sem duplicar)
    const antes = await tabelaCompleta();
    const p2 = await previa(fonte);
    if (!p2.conectado) throw new Error("sem banco");
    expect([p2.plano.novosTotal, p2.plano.alteradosTotal, p2.plano.removiveisTotal, p2.plano.iguais]).toEqual([0, 0, 0, 5]);
    const r2 = await confirmar(fonte, p2.plano.hashPlano);
    expect(r2.status === "gravado" && [r2.inseridos, r2.atualizados, r2.removidos]).toEqual([0, 0, 0]);
    expect(await tabelaCompleta()).toEqual(antes);
  });

  it("SEM aprovar a exclusão o banco NÃO espelha a planilha: o plano e o resultado deixam isso explícito (a diferença é o que sobra)", async () => {
    const fonte = await cenario();
    await sql`delete from brindes where unidade_id = (select id from unidades where codigo = 'BG 02')`;
    const p = await previa(fonte, { semExclusao: true });
    if (!p.conectado) throw new Error("sem banco");
    expect(p.plano.espelhaPlanilhaAposAplicar).toBe(false);
    expect(p.plano.sobraAposAplicarCentavos).toBe(1000 + 500 + 700);
    expect(p.plano.riscos.map((x) => x.codigo)).toContain("NAO_ESPELHA_A_PLANILHA");
    const r = await acoes.confirmarSincronizacaoBase({ base: "brindes", registros: compactarLote("brindes", fonte), opcoes: { semExclusao: true }, hashPlanoAprovado: p.plano.hashPlano });
    expect(r.status).toBe("gravado");
    if (r.status === "gravado") expect(r.totalNoEscopoDepois.centavos).toBe(p.plano.totalFinalNoEscopoCentavos);
    const somaBanco = (await escopoRows()).reduce((s, x) => s + Number(x.v), 0);
    expect(somaBanco).toBeGreaterThan(fonte.reduce((s, x) => s + x.valor, 0)); // acumulou: é por isso que a exclusão precisa ser aprovada
  });

  describe("recuperação pelo backup", () => {
    async function sincronizado() {
      const fonte = await cenario();
      await sql`delete from brindes where unidade_id = (select id from unidades where codigo = 'BG 02')`;
      const antesTudo = await tabelaCompleta();
      const p = await previa(fonte);
      if (!p.conectado) throw new Error("sem banco");
      const r = await confirmar(fonte, p.plano.hashPlano, { confirmacaoExclusao: "EXCLUIR 3" });
      if (r.status !== "gravado" || !r.backup) throw new Error("falhou: " + JSON.stringify(r));
      return { antesTudo, backup: JSON.parse(readFileSync(r.backup, "utf-8")), arquivo: r.backup };
    }

    it("o backup guarda as linhas completas excluídas, o valor anterior das alteradas e as chaves inseridas", async () => {
      const { backup } = await sincronizado();
      expect(backup.removidos).toHaveLength(3);
      expect(backup.removidos[0]).toHaveProperty("criado_em");
      expect(backup.alterados).toHaveLength(1);
      expect(Number(backup.alterados[0].antes.valor)).toBe(20);
      expect(backup.novos).toHaveLength(3);
    });

    it("restaurar desfaz a sincronização: o banco volta IDÊNTICO (todos os campos) ao estado anterior; a simulação não grava", async () => {
      const { antesTudo, backup } = await sincronizado();
      const depoisSync = await tabelaCompleta();
      const sim = await restaurarBackup(sql, backup, { confirmar: false, removerNovos: true });
      expect(sim.status).toBe("simulacao");
      expect([sim.plano.reinserir, sim.plano.reverterValores, sim.plano.removerNovos, sim.plano.conflitos.length]).toEqual([3, 1, 3, 0]);
      expect(await tabelaCompleta()).toEqual(depoisSync); // simulação não altera
      const r = await restaurarBackup(sql, backup, { confirmar: true, removerNovos: true });
      expect(r, JSON.stringify(r)).toMatchObject({ status: "restaurado" });
      expect(await tabelaCompleta()).toEqual(antesTudo);
    });

    it("sem --remover-novos só devolve o que foi excluído/alterado; remover os inseridos é uma exclusão e exige a variável", async () => {
      const { backup } = await sincronizado();
      const guardada = process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
      delete process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
      try {
        const bloqueado = await restaurarBackup(sql, backup, { confirmar: true, removerNovos: true });
        expect(bloqueado.status).toBe("bloqueado");
        const parcial = await restaurarBackup(sql, backup, { confirmar: true, removerNovos: false });
        expect(parcial.status).toBe("restaurado");
      } finally {
        process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = guardada;
      }
      const dentro = await escopoRows();
      expect(dentro.some((x) => x.motivo2 === "DESCONTO")).toBe(true); // voltou o que tinha sido excluído
      expect(dentro.some((x) => x.motivo === "BRINDE NOVO")).toBe(true); // os inseridos continuam (não foram removidos)
    });

    it("conflito: se o banco mudou depois da sincronização, a restauração é BLOQUEADA e nada muda", async () => {
      const { backup } = await sincronizado();
      await ins("BG 01", "2026-06-01", "BRINDE PRESENTE", "DESCONTO", "1.00"); // alguém recriou a chave de um removido
      const antes = await tabelaCompleta();
      const r = await restaurarBackup(sql, backup, { confirmar: true, removerNovos: true });
      expect(r.status).toBe("bloqueado");
      expect(r.plano.conflitos.length).toBeGreaterThan(0);
      expect(await tabelaCompleta()).toEqual(antes);
    });

    it("não restaura duas vezes: com os registros já de volta, os ids existentes bloqueiam", async () => {
      const { backup } = await sincronizado();
      expect((await restaurarBackup(sql, backup, { confirmar: true, removerNovos: true })).status).toBe("restaurado");
      const antes = await tabelaCompleta();
      expect((await restaurarBackup(sql, backup, { confirmar: true, removerNovos: true })).status).toBe("bloqueado");
      expect(await tabelaCompleta()).toEqual(antes);
    });

    it("backup inválido ou de outra tabela é recusado", async () => {
      await expect(restaurarBackup(sql, { base: "troco" }, { confirmar: false })).rejects.toThrow(/sem sincronização autoritativa/);
      await expect(restaurarBackup(sql, { base: "brindes", tabela: "compra_direta" }, { confirmar: false })).rejects.toThrow(/não corresponde/);
      await expect(restaurarBackup(sql, null, { confirmar: false })).rejects.toThrow(/ilegível/);
    });

    it("comando `atualizar-bases --restaurar`: simula sem gravar; --confirmar restaura; --remover-novos exige a variável", async () => {
      const { antesTudo, arquivo } = await sincronizado();
      const raiz = resolve(__dirname, "..", "..");
      const rodar = (extra: string[], env: Record<string, string | undefined> = {}) =>
        spawnSync(process.execPath, ["--import", "tsx", "scripts/atualizar-bases.ts", "--restaurar", arquivo, ...extra], { cwd: raiz, env: { ...process.env, DATABASE_URL: URL_TESTE, ...env } as NodeJS.ProcessEnv, encoding: "utf-8", timeout: 120_000 });
      const depoisSync = await tabelaCompleta();
      const sim = rodar(["--remover-novos"]);
      expect(sim.status).toBe(0);
      expect(sim.stdout).toMatch(/reinserir \(excluídos\): 3/);
      expect(await tabelaCompleta()).toEqual(depoisSync);
      const semVar = rodar(["--confirmar", "--remover-novos"], { SINCRONIZACAO_EXCLUSOES_HABILITADAS: "0" });
      expect(semVar.status).toBe(2);
      expect(await tabelaCompleta()).toEqual(depoisSync);
      const ok = rodar(["--confirmar", "--remover-novos"], { SINCRONIZACAO_EXCLUSOES_HABILITADAS: "1" });
      expect(ok.status).toBe(0);
      expect(ok.stdout).toMatch(/RESTAURAÇÃO CONCLUÍDA/);
      expect(await tabelaCompleta()).toEqual(antesTudo);
      expect(readdirSync(backupDir).length).toBeGreaterThan(0);
    });
  });
});
