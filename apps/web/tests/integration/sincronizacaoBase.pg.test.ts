import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gravarBackupSincronizacao } from "@/lib/import/backupCorrecao";
import { planejarNoBanco, sincronizarBase, type ConteudoBackupSincronizacao } from "@/lib/import/bancoSincronizacaoPg";
import { BASES_SNAPSHOT, CONFIG_SINCRONIZACAO, type BaseSnapshot } from "@/lib/import/sincronizacaoBase";
import type { RegistroBase } from "@/lib/import/tipos";

/**
 * Sincronização autoritativa em PostgreSQL REAL, LOCAL e DESCARTÁVEL (PG_TESTE_URL → 127.0.0.1/descartavel). Dados 100%
 * sintéticos. Recusa qualquer outro destino (Supabase, produção, banco compartilhado).
 */
const URL_TESTE = process.env.PG_TESTE_URL ?? "";
let sqlA: postgres.Sql;
let sqlB: postgres.Sql; // segunda conexão independente (outra sessão)
const dirs: string[] = [];
const novoDir = () => { const d = mkdtempSync(join(tmpdir(), "sync-pg-")); dirs.push(d); return d; };

const TABELAS: Record<BaseSnapshot, string> = { faturamento: "faturamento", formasPagamento: "formas_pagamento", brindes: "brindes", cancelamentoSalao: "cancelamento_salao", cancelamentoDelivery: "cancelamento_delivery", compraDireta: "compra_direta", retiradaDeposito: "retirada_deposito" };
const COLUNAS_CHAVE: Record<BaseSnapshot, string[]> = {
  faturamento: [], formasPagamento: ["forma"], brindes: ["motivo", "motivo2"], cancelamentoSalao: ["motivo"], cancelamentoDelivery: ["motivo"], compraDireta: ["motivo"],
  retiradaDeposito: ["caixa", "motivo", "motivo_descricao", "usuario", "usuario_autorizador"],
};

async function recriar(): Promise<void> {
  await sqlA.unsafe("drop schema public cascade; create schema public;");
  await sqlA.unsafe("create table unidades (id uuid primary key default gen_random_uuid(), codigo text unique not null, nome text)");
  for (const base of BASES_SNAPSHOT) {
    const cols = COLUNAS_CHAVE[base];
    const defs = cols.map((c) => `${c} text not null default ''`).join(", ");
    await sqlA.unsafe(`create table ${TABELAS[base]} (
      id uuid primary key default gen_random_uuid(),
      unidade_id uuid not null references unidades(id), data date not null, importacao_id uuid,
      criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
      ${defs}${defs ? "," : ""} valor numeric(14,2) not null,
      unique (unidade_id, data${cols.map((c) => `, ${c}`).join("")}))`);
  }
  await sqlA.unsafe("create table troco (id uuid primary key default gen_random_uuid(), v text, criado_em timestamptz default now(), atualizado_em timestamptz default now()); insert into troco (v) values ('a'),('b')");
  await sqlA.unsafe("insert into unidades (codigo, nome) values ('BG 01','BG 01'),('BG 02','BG 02'),('BG 03','BG 03')");
}

type Chave = string[];
async function inserir(base: BaseSnapshot, unidade: string, data: string, chave: Chave, valor: string, id?: string): Promise<string> {
  const cols = COLUNAS_CHAVE[base];
  const [u] = await sqlA`select id from unidades where codigo = ${unidade}`;
  const nomes = ["unidade_id", "data", ...cols, "valor", ...(id ? ["id"] : [])];
  const vals: unknown[] = [u.id, data, ...chave, valor, ...(id ? [id] : [])];
  const ph = vals.map((_, i) => `$${i + 1}`);
  ph[0] += "::uuid"; ph[1] += "::date"; ph[2 + cols.length] += "::numeric"; if (id) ph[ph.length - 1] += "::uuid";
  const [r] = await sqlA.unsafe(`insert into ${TABELAS[base]} (${nomes.join(", ")}) values (${ph.join(", ")}) returning id::text`, vals as never[]);
  return r.id as string;
}

const reg = (base: BaseSnapshot, unidade: string, data: string, chave: Chave, valor: number): RegistroBase => {
  const extras: Record<string, string> = {};
  CONFIG_SINCRONIZACAO[base].camposChave.forEach((c, i) => { extras[c] = chave[i] ?? ""; });
  return { unidade: unidade as RegistroBase["unidade"], data: new Date(`${data}T00:00:00.000Z`), valor, extras, linhaOrigem: 0 };
};

const chaveExemplo = (base: BaseSnapshot, sufixo: string): Chave => COLUNAS_CHAVE[base].map((c, i) => (i === 0 ? `${c}-${sufixo}` : i === 1 && base === "retiradaDeposito" ? "DEPOSITO" : `${c}-${sufixo}`));

const hashTabela = async (t: string) => (await sqlA.unsafe(`select count(*)::int n, md5(coalesce(string_agg(j, ',' order by j), '')) h from (select to_jsonb(x)::text j from ${t} x) s`))[0] as unknown as { n: number; h: string };
const todasTabelas = [...Object.values(TABELAS), "troco", "unidades"];
const snapshotGeral = async () => Object.fromEntries(await Promise.all(todasTabelas.map(async (t) => [t, await hashTabela(t)])));
const backupEm = (dir: string) => async (c: ConteudoBackupSincronizacao) => gravarBackupSincronizacao(dir, c);

describe.skipIf(!URL_TESTE)("sincronização autoritativa — PostgreSQL LOCAL descartável", () => {
  beforeAll(async () => {
    const u = new URL(URL_TESTE);
    expect(["127.0.0.1", "localhost"]).toContain(u.hostname);
    expect(URL_TESTE).not.toMatch(/supabase|pooler|amazonaws|neon\.tech/i);
    expect(URL_TESTE).not.toBe(process.env.DATABASE_URL ?? "__sem__");
    expect(u.pathname).toBe("/descartavel");
    process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = "1"; // opt-in explícito: os testes de exclusão precisam dele
    sqlA = postgres(URL_TESTE, { max: 1, ssl: false, onnotice: () => {} });
    sqlB = postgres(URL_TESTE, { max: 1, ssl: false, onnotice: () => {} });
    const [info] = await sqlA`select current_database() db`;
    expect(info.db).toBe("descartavel");
  });
  afterAll(async () => {
    await sqlA?.end();
    await sqlB?.end();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  describe.each(BASES_SNAPSHOT)("%s — uma base por vez", (base) => {
    it("simulação não grava; gravação aprovada (hash + backup) remove só o ID certo, altera, insere e preserva o resto", async () => {
      await recriar();
      const k = (s: string) => chaveExemplo(base, s);
      const idIgual = await inserir(base, "BG 01", "2026-10-01", k("igual"), "10.00");
      const idAlterado = await inserir(base, "BG 01", "2026-10-02", k("alt"), "20.00");
      // Faturamento tem chave só loja+dia: o "antigo" só pode ser um DIA que deixou de existir na fonte (exige confirmação explícita)
      const ehFat = base === "faturamento";
      const idOrfao = await inserir(base, "BG 01", ehFat ? "2026-10-04" : "2026-10-02", k("orfao"), "7.50");
      const opcoesBase = { confirmarDiasSemMovimento: ehFat };
      const idHistorico = await inserir(base, "BG 01", "2026-09-15", k("hist"), "99.00"); // fora do intervalo do arquivo
      await inserir(base, "BG 02", "2026-09-20", k("outra-loja"), "5.00"); // outra loja, fora do intervalo
      const fonte = [reg(base, "BG 01", "2026-10-01", k("igual"), 10), reg(base, "BG 01", "2026-10-02", k("alt"), 25), reg(base, "BG 01", ehFat ? "2026-10-05" : "2026-10-03", k("novo"), 3)];

      const antes = await snapshotGeral();
      const sim = await sincronizarBase(sqlA, base, fonte, { confirmar: false, ...opcoesBase });
      expect(sim.status).toBe("simulacao");
      expect(await snapshotGeral()).toEqual(antes); // simulação não altera nada
      const plano = sim.plano;
      expect([plano.novos.length, plano.iguais, plano.alterados.length, plano.removiveis.length]).toEqual([1, 1, 1, 1]);
      expect(plano.removiveis[0].id).toBe(idOrfao);
      expect(plano.exclusoesPermitidas).toBe(true);

      const dir = novoDir();
      const g = await sincronizarBase(sqlA, base, fonte, { confirmar: true, ...opcoesBase, hashPlanoAprovado: plano.hashPlano, gravarBackup: backupEm(dir) });
      expect(g.status).toBe("gravado");
      if (g.status === "gravado") {
        expect([g.inseridos, g.atualizados, g.removidos]).toEqual([1, 1, 1]);
        expect(g.totalNoEscopoDepois).toEqual({ chaves: 3, centavos: 1000 + 2500 + 300 });
        const bk = JSON.parse(readFileSync(g.backup!, "utf-8"));
        expect(bk.removidos).toHaveLength(1);
        expect(bk.removidos[0].id).toBe(idOrfao);
        expect(bk.removidos[0]).toHaveProperty("criado_em"); // linha completa
        expect(bk.alterados[0].antes.id).toBe(idAlterado);
      }
      const ids = (await sqlA.unsafe(`select id::text from ${TABELAS[base]}`)).map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([idIgual, idAlterado, idHistorico]));
      expect(ids).not.toContain(idOrfao);
      expect(ids).toHaveLength(5); // 3 do escopo + histórico + outra loja
      const depois = await snapshotGeral();
      for (const t of todasTabelas.filter((x) => x !== TABELAS[base])) expect(depois[t]).toEqual(antes[t]); // demais tabelas intactas
    });
  });

  describe("trava de exclusões: opt-in explícito", () => {
    async function comVariavel(valor: string | undefined, fn: () => Promise<void>) {
      const guardada = process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
      if (valor === undefined) delete process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
      else process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = valor;
      try {
        await fn();
      } finally {
        process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = guardada;
      }
    }
    it.each([[undefined], ["0"], [""], ["true"], [" 1"]])("variável = %j: o motor RECUSA excluir mesmo com hash e backup corretos e nada muda", async (valor) => {
      await recriar();
      await inserir("compraDireta", "BG 01", "2026-10-01", ["OPEX"], "10.00");
      await inserir("compraDireta", "BG 01", "2026-10-01", ["FIXAS"], "4.00");
      const fonte = [reg("compraDireta", "BG 01", "2026-10-01", ["OPEX"], 10)];
      const plano = (await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false })).plano;
      const antes = await snapshotGeral();
      const dir = novoDir();
      await comVariavel(valor, async () => {
        const r = await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, hashPlanoAprovado: plano.hashPlano, gravarBackup: backupEm(dir) });
        expect(r.status).toBe("bloqueado");
        if (r.status === "bloqueado") expect(r.motivo).toMatch(/SINCRONIZACAO_EXCLUSOES_HABILITADAS=1/);
      });
      expect(await snapshotGeral()).toEqual(antes);
      expect(readdirSync(dir)).toHaveLength(0); // nem backup é gerado: o bloqueio vem antes
    });
    it("sem a variável, gravar SEM exclusão (novos/alterados, ou 'preservar') continua permitido", async () => {
      await recriar();
      await inserir("compraDireta", "BG 01", "2026-10-01", ["OPEX"], "10.00");
      await inserir("compraDireta", "BG 01", "2026-10-01", ["FIXAS"], "4.00");
      const fonte = [reg("compraDireta", "BG 01", "2026-10-01", ["OPEX"], 10), reg("compraDireta", "BG 01", "2026-10-02", ["NOVO"], 1)];
      await comVariavel(undefined, async () => {
        const r = await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, semExclusao: true });
        expect(r.status).toBe("gravado");
        if (r.status === "gravado") expect(r.removidos).toBe(0);
      });
      expect(await contarCompra()).toBe(3);
    });
  });

  describe("recusas e bloqueios (nada é gravado)", () => {
    const k = ["OPEX"];
    async function cenario() {
      await recriar();
      await inserir("compraDireta", "BG 01", "2026-10-01", k, "10.00");
      await inserir("compraDireta", "BG 01", "2026-10-01", ["FIXAS"], "4.00");
      return [reg("compraDireta", "BG 01", "2026-10-01", k, 10)];
    }
    it("exclusão sem hash, com hash errado ou sem backup é recusada", async () => {
      const fonte = await cenario();
      const antes = await snapshotGeral();
      const dir = novoDir();
      const plano = (await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false })).plano;
      expect((await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, gravarBackup: backupEm(dir) })).status).toBe("bloqueado");
      expect((await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, hashPlanoAprovado: "0".repeat(64), gravarBackup: backupEm(dir) })).status).toBe("bloqueado");
      expect((await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, hashPlanoAprovado: plano.hashPlano })).status).toBe("bloqueado"); // sem backup
      expect(await snapshotGeral()).toEqual(antes);
      expect(readdirSync(dir)).toHaveLength(0);
    });
    it("falha ao gravar o backup impede qualquer alteração", async () => {
      const fonte = await cenario();
      const antes = await snapshotGeral();
      const plano = (await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false })).plano;
      const r = await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, hashPlanoAprovado: plano.hashPlano, gravarBackup: async () => { throw new Error("disco cheio"); } });
      expect(r.status).toBe("bloqueado");
      expect(await snapshotGeral()).toEqual(antes);
    });
    it("loja que existe no banco no período mas não no arquivo: preservada, exclusão bloqueada; --sem-exclusao grava só novos/alterados", async () => {
      const fonte = await cenario();
      await inserir("compraDireta", "BG 02", "2026-10-01", ["OPEX"], "50.00"); // loja ausente do arquivo
      const antes = await snapshotGeral();
      const dir = novoDir();
      const sim = await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false });
      expect(sim.plano.riscos.map((r) => r.codigo)).toContain("LOJA_AUSENTE_NO_ARQUIVO");
      expect(sim.plano.idsParaRemover).toEqual([]);
      const bloqueado = await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, hashPlanoAprovado: sim.plano.hashPlano, gravarBackup: backupEm(dir) });
      expect(bloqueado.status).toBe("bloqueado");
      expect(await snapshotGeral()).toEqual(antes);
      const fonte2 = [...fonte, reg("compraDireta", "BG 01", "2026-10-02", ["NOVO"], 1)];
      const sem = await sincronizarBase(sqlA, "compraDireta", fonte2, { confirmar: true, semExclusao: true, gravarBackup: backupEm(dir) });
      expect(sem.status).toBe("gravado");
      expect(await contarCompra()).toBe(4); // 3 antes + 1 novo; nada removido (nem BG 02 nem o antigo FIXAS)
    });
    it("dia sem nenhuma linha na fonte só é excluído com confirmação explícita (e a confirmação entra no hash)", async () => {
      await recriar();
      await inserir("compraDireta", "BG 01", "2026-10-01", k, "10.00");
      await inserir("compraDireta", "BG 01", "2026-10-02", k, "6.00"); // dia sem linha na fonte
      const fonte = [reg("compraDireta", "BG 01", "2026-10-01", k, 10), reg("compraDireta", "BG 01", "2026-10-03", k, 1)];
      const dir = novoDir();
      const sem = await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false });
      expect(sem.plano.riscos.find((r) => r.codigo === "DIAS_SEM_MOVIMENTO")).toBeTruthy();
      expect((await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, hashPlanoAprovado: sem.plano.hashPlano, gravarBackup: backupEm(dir) })).status).toBe("bloqueado");
      const com = await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false, confirmarDiasSemMovimento: true });
      expect(com.plano.hashPlano).not.toBe(sem.plano.hashPlano);
      const g = await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, confirmarDiasSemMovimento: true, hashPlanoAprovado: com.plano.hashPlano, gravarBackup: backupEm(dir) });
      expect(g.status).toBe("gravado");
      expect(await contarCompra()).toBe(2);
    });
    it("limite configurado excedido bloqueia a exclusão", async () => {
      const fonte = await cenario();
      const r = await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false, limites: { maxRemocoes: 0 } });
      expect(r.plano.riscos.map((x) => x.codigo)).toContain("LIMITE_EXCEDIDO");
      expect(r.plano.podeGravar).toBe(false);
    });
  });

  describe("rollback real (gatilhos no banco descartável)", () => {
    const k = ["OPEX"];
    async function cenario() {
      await recriar();
      await inserir("compraDireta", "BG 01", "2026-10-01", k, "10.00", "11111111-1111-4111-8111-111111111111");
      await inserir("compraDireta", "BG 01", "2026-10-01", ["FIXAS"], "4.00", "22222222-2222-4222-8222-222222222222");
      await inserir("compraDireta", "BG 01", "2026-10-02", ["OUTRO"], "3.00", "33333333-3333-4333-8333-333333333333");
      await inserir("compraDireta", "BG 02", "2026-09-01", ["HIST"], "8.00", "44444444-4444-4444-8444-444444444444"); // fora do escopo
      return [reg("compraDireta", "BG 01", "2026-10-01", k, 10), reg("compraDireta", "BG 01", "2026-10-02", ["OUTRO"], 3)];
    }
    async function tentar(fonte: RegistroBase[]) {
      const plano = (await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false })).plano;
      return sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, hashPlanoAprovado: plano.hashPlano, gravarBackup: backupEm(novoDir()) });
    }
    const intacto = async (antes: Record<string, { n: number; h: string }>) => expect(await snapshotGeral()).toEqual(antes);

    it("ROLLBACK se o delete afetar menos linhas (gatilho impede a exclusão)", async () => {
      const fonte = await cenario();
      const antes = await snapshotGeral();
      await sqlA.unsafe(`create function pula() returns trigger language plpgsql as $$ begin return null; end $$; create trigger t before delete on compra_direta for each row execute function pula();`);
      const r = await tentar(fonte);
      expect(r.status).toBe("revertido");
      if (r.status === "revertido") expect(r.erro).toMatch(/removidos 0, esperado exatamente 1/);
      await intacto(antes);
    });
    it("ROLLBACK se algo FORA do escopo mudar (gatilho apaga o registro histórico)", async () => {
      const fonte = await cenario();
      const antes = await snapshotGeral();
      await sqlA.unsafe(`create function apaga_hist() returns trigger language plpgsql as $$ begin delete from compra_direta where id = '44444444-4444-4444-8444-444444444444'; return old; end $$; create trigger t after delete on compra_direta for each row execute function apaga_hist();`);
      const r = await tentar(fonte);
      expect(r.status).toBe("revertido");
      if (r.status === "revertido") expect(r.erro).toMatch(/fora do escopo/);
      await intacto(antes);
    });
    it("ROLLBACK se a validação final divergir (gatilho altera valor de outro registro do escopo)", async () => {
      const fonte = await cenario();
      const antes = await snapshotGeral();
      await sqlA.unsafe(`create function altera() returns trigger language plpgsql as $$ begin update compra_direta set valor = valor + 1 where id = '33333333-3333-4333-8333-333333333333'; return old; end $$; create trigger t after delete on compra_direta for each row execute function altera();`);
      const r = await tentar(fonte);
      expect(r.status).toBe("revertido");
      if (r.status === "revertido") expect(r.erro).toMatch(/validação final falhou/);
      await intacto(antes);
    });
    it("ROLLBACK se houver falha depois da exclusão e ANTES do commit (gatilho diferido)", async () => {
      const fonte = await cenario();
      const antes = await snapshotGeral();
      await sqlA.unsafe(`create function falha() returns trigger language plpgsql as $$ begin raise exception 'falha simulada antes do commit'; end $$; create constraint trigger t after delete on compra_direta deferrable initially deferred for each row execute function falha();`);
      const r = await tentar(fonte);
      expect(r.status).toBe("revertido");
      if (r.status === "revertido") expect(r.erro).toMatch(/falha simulada antes do commit/);
      await intacto(antes);
    });
    it("concorrência: outra sessão altera um registro do escopo entre a simulação e a transação → revertido, alteração dela preservada", async () => {
      const fonte = await cenario();
      const plano = (await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false })).plano;
      const r = await sincronizarBase(sqlA, "compraDireta", fonte, {
        confirmar: true, hashPlanoAprovado: plano.hashPlano,
        gravarBackup: async (c) => { await sqlB`update compra_direta set valor = 77.00 where id = '33333333-3333-4333-8333-333333333333'::uuid`; return backupEm(novoDir())(c); },
      });
      expect(r.status).toBe("revertido");
      if (r.status === "revertido") expect(r.erro).toMatch(/banco mudou entre a simulação e a gravação/);
      expect(await contarCompra()).toBe(4);
      expect((await sqlA`select valor::text v from compra_direta where id = '33333333-3333-4333-8333-333333333333'::uuid`)[0].v).toBe("77.00");
    });
    it("concorrência: outra sessão INSERE um registro novo no escopo antes da transação → revertido", async () => {
      const fonte = await cenario();
      const plano = (await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false })).plano;
      const r = await sincronizarBase(sqlA, "compraDireta", fonte, {
        confirmar: true, hashPlanoAprovado: plano.hashPlano,
        gravarBackup: async (c) => { await sqlB`insert into compra_direta (unidade_id, data, motivo, valor) select id, date '2026-10-01', 'CHEGOU_AGORA', 9 from unidades where codigo = 'BG 01'`; return backupEm(novoDir())(c); },
      });
      expect(r.status).toBe("revertido");
      expect(await contarCompra()).toBe(5);
    });
    it("durante a transação as linhas do escopo ficam TRAVADAS para outra conexão (55P03)", async () => {
      const fonte = await cenario();
      await sqlA.unsafe(`create function lento() returns trigger language plpgsql as $$ begin perform pg_sleep(1.5); return old; end $$; create trigger t before delete on compra_direta for each row execute function lento();`);
      const plano = (await sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: false })).plano;
      const execucao = sincronizarBase(sqlA, "compraDireta", fonte, { confirmar: true, hashPlanoAprovado: plano.hashPlano, gravarBackup: backupEm(novoDir()) });
      await new Promise((r) => setTimeout(r, 700));
      let codigo = "";
      try {
        await sqlB.begin(async (b) => { await b.unsafe("set local lock_timeout = '300ms'"); await b`update compra_direta set valor = valor where id = '11111111-1111-4111-8111-111111111111'::uuid`; });
      } catch (e) { codigo = (e as { code?: string }).code ?? ""; }
      expect(codigo).toBe("55P03");
      expect((await execucao).status).toBe("gravado");
    });
  });

  it("reexecução depois de concluída é idempotente: nada é inserido, alterado ou removido", async () => {
    await recriar();
    await inserir("brindes", "BG 01", "2026-10-01", ["A", "x"], "1.00");
    await inserir("brindes", "BG 01", "2026-10-01", ["B", ""], "2.00");
    const fonte = [reg("brindes", "BG 01", "2026-10-01", ["A", "x"], 1)];
    const p1 = (await sincronizarBase(sqlA, "brindes", fonte, { confirmar: false })).plano;
    const g1 = await sincronizarBase(sqlA, "brindes", fonte, { confirmar: true, hashPlanoAprovado: p1.hashPlano, gravarBackup: backupEm(novoDir()) });
    expect(g1.status).toBe("gravado");
    const depois1 = await snapshotGeral();
    const p2 = await planejarNoBanco(sqlA, "brindes", fonte);
    expect([p2.novos.length, p2.alterados.length, p2.removiveis.length, p2.iguais]).toEqual([0, 0, 0, 1]);
    const g2 = await sincronizarBase(sqlA, "brindes", fonte, { confirmar: true, gravarBackup: backupEm(novoDir()) });
    expect(g2.status).toBe("gravado");
    if (g2.status === "gravado") expect([g2.inseridos, g2.atualizados, g2.removidos]).toEqual([0, 0, 0]);
    expect(await snapshotGeral()).toEqual(depois1);
  });

  describe("comando `atualizar-bases` (processo real contra o banco descartável)", () => {
    const raiz = resolve(__dirname, "..", "..");
    async function xlsx(linhas: Array<[string, string, string]>) {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Planilha");
      ws.addRow(["Filial", "Caixa", "Data", "Valor", "Motivo", "Descrição", "Usuário", "Usuário autorizador"]);
      for (const [filial, data, motivo] of linhas.map((l) => l)) ws.addRow([filial, "CX 1", data, motivo === "OPEX" ? 10 : 25, motivo, "d", "u", "a"]);
      const dir = novoDir();
      const caminho = join(dir, "COMPRA DIRETA.xlsx");
      await wb.xlsx.writeFile(caminho);
      return caminho;
    }
    const rodar = (args: string[]) => {
      const env = { ...process.env, DATABASE_URL: URL_TESTE } as NodeJS.ProcessEnv;
      return spawnSync(process.execPath, ["--import", "tsx", "scripts/atualizar-bases.ts", ...args], { cwd: raiz, env, encoding: "utf-8", timeout: 120_000 });
    };
    async function preparar() {
      await recriar();
      // tabelas que o comando referencia no relatório final
      await sqlA.unsafe("create table if not exists cancelamento_salao_detalhe (id uuid primary key default gen_random_uuid(), v text)");
      await inserir("compraDireta", "BG 01", "2026-10-06", ["OPEX"], "10.00");
      await inserir("compraDireta", "BG 01", "2026-10-06", ["FIXAS"], "4.00"); // antigo: só no banco
      return xlsx([["BG 01", "06/10/2026", "OPEX"], ["BG 01", "07/10/2026", "CMV"]]);
    }
    it("simulação mostra o plano e o hash, exige aprovação (saída 2) e não grava", async () => {
      const arq = await preparar();
      const antes = await snapshotGeral();
      const r = rodar([arq]);
      expect(r.status).toBe(2);
      expect(r.stdout).toMatch(/HASH DO PLANO: [0-9a-f]{64}/);
      expect(r.stdout).toMatch(/aguardam SUA aprovação/);
      expect(await snapshotGeral()).toEqual(antes);
    });
    it("gravação sem aprovação, com hash errado ou sem --backup-dir não altera nada", async () => {
      const arq = await preparar();
      const antes = await snapshotGeral();
      const dir = novoDir();
      expect(rodar([arq, "--gravar", "--backup-dir", dir]).status).toBe(2);
      expect(rodar([arq, "--gravar", "--aprovar-exclusoes", `compraDireta=${"0".repeat(64)}`, "--backup-dir", dir]).status).toBe(2);
      const hash = /HASH DO PLANO: ([0-9a-f]{64})/.exec(rodar([arq]).stdout)![1];
      const semBackup = rodar([arq, "--gravar", "--aprovar-exclusoes", `compraDireta=${hash}`]);
      expect(semBackup.status).toBe(1);
      expect(await snapshotGeral()).toEqual(antes);
      expect(readdirSync(dir)).toHaveLength(0);
    });
    it("sem SINCRONIZACAO_EXCLUSOES_HABILITADAS=1 a gravação com exclusão é RECUSADA no comando, mesmo com hash e backup corretos", async () => {
      const arq = await preparar();
      const antes = await snapshotGeral();
      const dir = novoDir();
      const hash = /HASH DO PLANO: ([0-9a-f]{64})/.exec(rodar([arq]).stdout)![1];
      const guardada = process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
      try {
        for (const valor of [undefined, "0"]) {
          if (valor === undefined) delete process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
          else process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = valor;
          const r = rodar([arq, "--gravar", "--aprovar-exclusoes", `compraDireta=${hash}`, "--backup-dir", dir]);
          expect(r.status).toBe(1);
          expect(r.stdout).toMatch(/SINCRONIZACAO_EXCLUSOES_HABILITADAS=1/);
        }
        // a simulação avisa que a exclusão está BLOQUEADA
        delete process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
        expect(rodar([arq]).stdout).toMatch(/hoje BLOQUEADO/);
      } finally {
        process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = guardada;
      }
      expect(await snapshotGeral()).toEqual(antes);
      expect(readdirSync(dir)).toHaveLength(0);
    });
    it("com o hash aprovado e backup grava exatamente o plano; repetir não exclui mais nada", async () => {
      const arq = await preparar();
      const dir = novoDir();
      const hash = /HASH DO PLANO: ([0-9a-f]{64})/.exec(rodar([arq]).stdout)![1];
      const planoArq = join(dir, "plano.json");
      const r = rodar([arq, "--gravar", "--aprovar-exclusoes", `compraDireta=${hash}`, "--backup-dir", dir, "--plano", join(tmpdir(), "x-nao-existe.json")]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/removidos 1/);
      expect(readdirSync(dir).filter((f) => f.startsWith("backup-sincronizacao-compraDireta"))).toHaveLength(1);
      expect(await contarCompra()).toBe(2);
      const ids = (await sqlA`select motivo from compra_direta order by motivo`).map((x) => x.motivo);
      expect(ids).toEqual(["CMV", "OPEX"]);
      const r2 = rodar([arq]); // nova simulação: nada pendente
      expect(r2.status).toBe(0);
      expect(r2.stdout).toMatch(/novos: 0 \| iguais: 2 \| alterados \(valor\): 0 \| só no banco \(removíveis\): 0/);
      void planoArq;
    });
  });
});

async function contarCompra(): Promise<number> {
  return Number((await sqlA`select count(*)::int n from compra_direta`)[0].n);
}
void existsSync; void writeFileSync;
