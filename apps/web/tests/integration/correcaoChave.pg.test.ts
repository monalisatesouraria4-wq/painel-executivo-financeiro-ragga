import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gravarBackupSeguro } from "@/lib/import/backupCorrecao";
import { bancoCorrecaoPg, TABELAS_REFERENCIA_PADRAO } from "@/lib/import/bancoCorrecaoPg";
import { executarCorrecao, type BancoCorrecao, type PlanoCorrecao } from "@/lib/import/correcaoChave";

/**
 * Transação REAL da correção, em PostgreSQL LOCAL DESCARTÁVEL com dados sintéticos. Só roda com PG_TESTE_URL apontando
 * para 127.0.0.1 e banco "descartavel"; recusa qualquer outro destino (Supabase, produção, banco compartilhado).
 */
const URL_TESTE = process.env.PG_TESTE_URL ?? "";
const ID1 = "f12c2337-0be6-431c-a4fc-2550aa51f994";
const ID2 = "3252cfd4-672f-4671-9b73-bbc8de24cb95";
const ID3 = "95f20bdb-cc11-4fe2-9fcd-5ec134ab031e";
const SUB1 = "63779d1d-0aac-4239-8e72-fff56336141c";
const SUB2 = "91517d4d-381b-4a6c-a4df-6237ca9a64a6";
const SUB3 = "1573fbce-1320-4437-bde2-05f25027b23f";
const OUTRO = "aaaaaaaa-0000-4000-8000-000000000003"; // um dos "outros só-no-banco"
const OUTROS = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", OUTRO];

const PLANO: PlanoCorrecao = {
  base: "compraDireta",
  remover: [
    { id: ID1, unidade: "BG 07", data: "2026-10-06", motivo: "FIXAS", valor: "27.96", substituta: { motivo: "OPEX", valor: "27.96" } },
    { id: ID2, unidade: "BG 02", data: "2026-10-07", motivo: "CMO/EMERGENCIAIS", valor: "65.00", substituta: { motivo: "OPEX", valor: "65.00" } },
    { id: ID3, unidade: "BG 13", data: "2026-10-12", motivo: "FIXAS", valor: "38.78", substituta: { motivo: "CMO/EMERGENCIAIS", valor: "38.78" } },
  ],
};

let sqlA: postgres.Sql; // conexão principal (executa a correção)
let sqlB: postgres.Sql; // segunda conexão INDEPENDENTE (simula outra sessão)
const dirs: string[] = [];
const novoDir = () => { const d = mkdtempSync(join(tmpdir(), "corr-pg-")); dirs.push(d); return d; };

async function recriar(): Promise<void> {
  await sqlA.unsafe("drop schema public cascade; create schema public;");
  await sqlA.unsafe(`
    create table unidades (id uuid primary key default gen_random_uuid(), codigo text unique not null, nome text);
    create table compra_direta (
      id uuid primary key default gen_random_uuid(),
      unidade_id uuid not null references unidades(id),
      data date not null,
      importacao_id uuid,
      criado_em timestamptz not null default now(),
      atualizado_em timestamptz not null default now(),
      motivo text not null,
      valor numeric(14,2) not null,
      unique (unidade_id, data, motivo)
    );`);
  for (const t of TABELAS_REFERENCIA_PADRAO.filter((x) => x !== "compra_direta")) {
    await sqlA.unsafe(`create table ${t} (id uuid primary key default gen_random_uuid(), v text, criado_em timestamptz default now(), atualizado_em timestamptz default now()); insert into ${t} (v) values ('a'),('b'),('c');`);
  }
  await sqlA.unsafe(`insert into unidades (codigo, nome) values ('BG 07','BG 07'),('BG 02','BG 02'),('BG 13','BG 13'),('BG 05','BG 05')`);
  const linhas: Array<[string, string, string, string, string]> = [
    [ID1, "BG 07", "2026-10-06", "FIXAS", "27.96"], [SUB1, "BG 07", "2026-10-06", "OPEX", "27.96"],
    [ID2, "BG 02", "2026-10-07", "CMO/EMERGENCIAIS", "65.00"], [SUB2, "BG 02", "2026-10-07", "OPEX", "65.00"],
    [ID3, "BG 13", "2026-10-12", "FIXAS", "38.78"], [SUB3, "BG 13", "2026-10-12", "CMO/EMERGENCIAIS", "38.78"],
    [OUTROS[0], "BG 07", "2026-07-06", "FIXAS", "31.92"], [OUTROS[1], "BG 13", "2026-07-30", "FIXAS", "33.48"], [OUTROS[2], "BG 05", "2026-09-10", "FIXAS", "194.96"],
  ];
  for (const [id, u, d, m, v] of linhas) await sqlA`insert into compra_direta (id, unidade_id, data, motivo, valor) select ${id}::uuid, un.id, ${d}::date, ${m}, ${v}::numeric from unidades un where un.codigo = ${u}`;
}

const contar = async () => Number((await sqlA`select count(*)::int n from compra_direta`)[0].n);
const idsPresentes = async () => (await sqlA`select id::text from compra_direta order by id`).map((r) => r.id as string);

describe.skipIf(!URL_TESTE)("correção Compra Direta — transação real em PostgreSQL LOCAL descartável", () => {
  let real: BancoCorrecao;

  beforeAll(async () => {
    // ---- ISOLAMENTO: recusa qualquer destino que não seja o PostgreSQL local descartável ----
    const u = new URL(URL_TESTE);
    expect(["127.0.0.1", "localhost"]).toContain(u.hostname);
    expect(URL_TESTE).not.toMatch(/supabase|pooler|amazonaws|neon\.tech/i);
    expect(URL_TESTE).not.toBe(process.env.DATABASE_URL ?? "__sem__");
    expect(u.pathname).toBe("/descartavel");
    process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = "1"; // opt-in explícito (o comando --corrigir também o exige)
    sqlA = postgres(URL_TESTE, { max: 1, ssl: false, onnotice: () => {} });
    sqlB = postgres(URL_TESTE, { max: 1, ssl: false, onnotice: () => {} });
    const [info] = await sqlA`select current_database() db, inet_server_addr()::text addr`;
    expect(info.db).toBe("descartavel");
    expect(["127.0.0.1/32", "::1/128", null]).toContain(info.addr);
    real = bancoCorrecaoPg(sqlA);
  });
  afterAll(async () => {
    await sqlA?.end();
    await sqlB?.end();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("exclusão exata dos 3 IDs, numa transação, preservando tudo fora do escopo", async () => {
    await recriar();
    const antes = await real.snapshot([ID1, ID2, ID3]);
    const outrosAntes = await sqlA`select id::text, to_jsonb(x)::text j from compra_direta x where id = any(${OUTROS}::uuid[]) order by id`;
    const r = await executarCorrecao(PLANO, real, { confirmar: true, gravarBackup: async (rs) => gravarBackupSeguro(novoDir(), PLANO, rs) });
    expect(r.status).toBe("gravado");
    expect(await contar()).toBe(6);
    expect(await idsPresentes()).not.toEqual(expect.arrayContaining([ID1]));
    expect(await idsPresentes()).toEqual(expect.arrayContaining([SUB1, SUB2, SUB3, ...OUTROS]));
    const depois = await real.snapshot([ID1, ID2, ID3]);
    expect(depois.compraDiretaSemAlvos).toEqual(antes.compraDiretaSemAlvos);
    for (const t of TABELAS_REFERENCIA_PADRAO.filter((x) => x !== "compra_direta")) expect(depois.tabelas[t]).toEqual(antes.tabelas[t]);
    const outrosDepois = await sqlA`select id::text, to_jsonb(x)::text j from compra_direta x where id = any(${OUTROS}::uuid[]) order by id`;
    expect(outrosDepois).toEqual(outrosAntes);
  });

  it("simulação (sem confirmar) não altera nada", async () => {
    await recriar();
    const antes = await real.snapshot([ID1, ID2, ID3]);
    const r = await executarCorrecao(PLANO, real, { confirmar: false });
    expect(r.status).toBe("simulacao");
    expect(await real.snapshot([ID1, ID2, ID3])).toEqual(antes);
  });

  it("backup é criado e verificado ANTES da transação; falha no backup impede qualquer exclusão", async () => {
    await recriar();
    const dir = novoDir();
    let backupsQuandoTransacaoComecou = -1;
    const espiao: BancoCorrecao = { ...real, transacao: (fn) => { backupsQuandoTransacaoComecou = readdirSync(dir).length; return real.transacao(fn); } };
    const ok = await executarCorrecao(PLANO, espiao, { confirmar: true, gravarBackup: async (rs) => gravarBackupSeguro(dir, PLANO, rs) });
    expect(ok.status).toBe("gravado");
    expect(backupsQuandoTransacaoComecou).toBe(1);

    await recriar();
    const arquivoComoPasta = join(novoDir(), "arquivo.txt");
    writeFileSync(arquivoComoPasta, "x");
    const antes = await real.snapshot([ID1, ID2, ID3]);
    const falha = await executarCorrecao(PLANO, real, { confirmar: true, gravarBackup: async (rs) => gravarBackupSeguro(join(arquivoComoPasta, "sub"), PLANO, rs) });
    expect(falha.status).toBe("pre-condicao-falhou");
    expect(await contar()).toBe(9);
    expect(await real.snapshot([ID1, ID2, ID3])).toEqual(antes);
  });

  describe("rollback real (gatilhos no banco descartável)", () => {
    const executar = () => executarCorrecao(PLANO, real, { confirmar: true, gravarBackup: async (rs) => gravarBackupSeguro(novoDir(), PLANO, rs) });
    const intacto = async (antes: Awaited<ReturnType<BancoCorrecao["snapshot"]>>) => {
      expect(await contar()).toBe(9);
      expect(await real.snapshot([ID1, ID2, ID3])).toEqual(antes);
    };

    it("ROLLBACK se o delete afetar linhas além das 3 (gatilho apaga um registro extra)", async () => {
      await recriar();
      const antes = await real.snapshot([ID1, ID2, ID3]);
      await sqlA.unsafe(`create function apaga_extra() returns trigger language plpgsql as $$ begin delete from compra_direta where id = '${OUTRO}'; return old; end $$;
        create trigger t_extra after delete on compra_direta for each row execute function apaga_extra();`);
      const r = await executar();
      expect(r.status).toBe("revertido");
      await intacto(antes);
    });

    it("ROLLBACK se o delete afetar MENOS linhas que o esperado (gatilho impede uma exclusão)", async () => {
      await recriar();
      const antes = await real.snapshot([ID1, ID2, ID3]);
      await sqlA.unsafe(`create function pula() returns trigger language plpgsql as $$ begin if old.id = '${ID2}' then return null; end if; return old; end $$;
        create trigger t_pula before delete on compra_direta for each row execute function pula();`);
      const r = await executar();
      expect(r.status).toBe("revertido");
      if (r.status === "revertido") expect(r.erro).toMatch(/removidos 2, esperado exatamente 3/);
      await intacto(antes);
    });

    it("ROLLBACK se o hash dos demais registros divergir (gatilho altera outro registro)", async () => {
      await recriar();
      const antes = await real.snapshot([ID1, ID2, ID3]);
      await sqlA.unsafe(`create function altera_outro() returns trigger language plpgsql as $$ begin update compra_direta set valor = valor + 1 where id = '${OUTRO}'; return old; end $$;
        create trigger t_altera after delete on compra_direta for each row execute function altera_outro();`);
      const r = await executar();
      expect(r.status).toBe("revertido");
      if (r.status === "revertido") expect(r.erro).toMatch(/diferem da referência/);
      await intacto(antes);
    });

    it("ROLLBACK se houver falha depois da exclusão e ANTES do commit (gatilho diferido falha no commit)", async () => {
      await recriar();
      const antes = await real.snapshot([ID1, ID2, ID3]);
      await sqlA.unsafe(`create function falha_no_commit() returns trigger language plpgsql as $$ begin raise exception 'falha simulada antes do commit'; end $$;
        create constraint trigger t_commit after delete on compra_direta deferrable initially deferred for each row execute function falha_no_commit();`);
      const r = await executar();
      expect(r.status).toBe("revertido");
      if (r.status === "revertido") expect(r.erro).toMatch(/falha simulada antes do commit/);
      await intacto(antes);
    });
  });

  describe("concorrência com duas conexões independentes", () => {
    it("as linhas substitutas e alvo ficam BLOQUEADAS (FOR UPDATE) durante a transação", async () => {
      await recriar();
      let erroSub = "";
      let erroAlvo = "";
      await real.transacao(async (tx) => {
        await tx.buscarPorIds([ID1]);
        await tx.buscarDoDia("BG 07", "2026-10-06"); // trava substituta (e alvo) do dia
        for (const [id, alvo] of [[SUB1, "sub"], [ID1, "alvo"]] as const) {
          try {
            await sqlB.begin(async (b) => {
              await b.unsafe("set local lock_timeout = '400ms'");
              await b`update compra_direta set valor = valor where id = ${id}::uuid`;
            });
          } catch (e) {
            const msg = (e as { code?: string }).code ?? "";
            if (alvo === "sub") erroSub = msg; else erroAlvo = msg;
          }
        }
      });
      expect(erroSub).toBe("55P03"); // lock_not_available
      expect(erroAlvo).toBe("55P03");
    });

    it("outra sessão altera um registro entre a referência e a transação → ROLLBACK e a alteração da outra sessão é preservada", async () => {
      await recriar();
      const concorrente: BancoCorrecao = {
        ...real,
        transacao: async (fn) => {
          await sqlB`update compra_direta set valor = 999.99 where id = ${OUTRO}::uuid`;
          return real.transacao(fn);
        },
      };
      const r = await executarCorrecao(PLANO, concorrente, { confirmar: true, gravarBackup: async (rs) => gravarBackupSeguro(novoDir(), PLANO, rs) });
      expect(r.status).toBe("revertido");
      expect(await contar()).toBe(9);
      expect((await sqlA`select valor::text v from compra_direta where id = ${OUTRO}::uuid`)[0].v).toBe("999.99");
    });

    it("outra sessão remove um dos alvos antes da transação → pré-condição falha DENTRO da transação e nada é excluído", async () => {
      await recriar();
      const concorrente: BancoCorrecao = {
        ...real,
        transacao: async (fn) => {
          await sqlB`delete from compra_direta where id = ${ID2}::uuid`;
          return real.transacao(fn);
        },
      };
      const r = await executarCorrecao(PLANO, concorrente, { confirmar: true, gravarBackup: async (rs) => gravarBackupSeguro(novoDir(), PLANO, rs) });
      expect(r.status).toBe("revertido");
      if (r.status === "revertido") expect(r.erro).toMatch(/pré-condição falhou na transação/);
      const ids = await idsPresentes();
      expect(ids).toEqual(expect.arrayContaining([ID1, ID3])); // os outros alvos NÃO foram excluídos
      expect(ids).toHaveLength(8);
    });

    it("outra sessão altera a substituta antes da transação → pré-condição falha dentro da transação", async () => {
      await recriar();
      const concorrente: BancoCorrecao = {
        ...real,
        transacao: async (fn) => {
          await sqlB`update compra_direta set valor = 1.00 where id = ${SUB3}::uuid`;
          return real.transacao(fn);
        },
      };
      const r = await executarCorrecao(PLANO, concorrente, { confirmar: true, gravarBackup: async (rs) => gravarBackupSeguro(novoDir(), PLANO, rs) });
      expect(r.status).toBe("revertido");
      expect(await contar()).toBe(9);
    });
  });

  it("reexecução depois de concluída é recusada e não exclui nada adicional", async () => {
    await recriar();
    const opcoes = { confirmar: true, gravarBackup: async (rs: Parameters<typeof gravarBackupSeguro>[2]) => gravarBackupSeguro(novoDir(), PLANO, rs) };
    expect((await executarCorrecao(PLANO, real, opcoes)).status).toBe("gravado");
    const idsAntes = await idsPresentes();
    const r2 = await executarCorrecao(PLANO, real, opcoes);
    expect(r2.status).toBe("pre-condicao-falhou");
    expect(await idsPresentes()).toEqual(idsAntes);
    expect(await contar()).toBe(6);
  });

  describe("comando `atualizar-bases --corrigir` (processo real contra o banco descartável)", () => {
    const raiz = resolve(__dirname, "..", "..");
    const rodar = (args: string[]) => {
      const env = { ...process.env, DATABASE_URL: URL_TESTE } as NodeJS.ProcessEnv;
      return spawnSync(process.execPath, ["--import", "tsx", "scripts/atualizar-bases.ts", "--corrigir", ...args], { cwd: raiz, env, encoding: "utf-8", timeout: 90_000 });
    };
    const arquivoPlano = (plano: unknown = PLANO) => {
      const caminho = join(novoDir(), "plano.json");
      const bytes = JSON.stringify(plano, null, 2);
      writeFileSync(caminho, bytes);
      return { caminho, sha: createHash("sha256").update(bytes).digest("hex") };
    };

    it("a simulação (padrão) não grava, mostra o SHA-256 do plano e o total de R$ 131,74", async () => {
      await recriar();
      const { caminho, sha } = arquivoPlano();
      const r = rodar([caminho]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(sha);
      expect(r.stdout).toMatch(/131,74/);
      expect(await contar()).toBe(9);
    });

    it("--confirmar sem --hash-plano, com hash errado ou sem --backup-dir é recusado", async () => {
      await recriar();
      const { caminho, sha } = arquivoPlano();
      const dir = novoDir();
      expect(rodar([caminho, "--confirmar", "--backup-dir", dir]).status).toBe(2);
      expect(rodar([caminho, "--confirmar", "--hash-plano", "0".repeat(64), "--backup-dir", dir]).status).toBe(2);
      expect(rodar([caminho, "--confirmar", "--hash-plano", sha]).status).toBe(2);
      expect(await contar()).toBe(9);
      expect(readdirSync(dir)).toHaveLength(0);
    });

    it("plano alterado depois da revisão (outro hash) é recusado; plano com valor errado falha nas pré-condições", async () => {
      await recriar();
      const revisado = arquivoPlano();
      const alterado = arquivoPlano({ ...PLANO, remover: [...PLANO.remover, { id: OUTRO, unidade: "BG 05", data: "2026-09-10", motivo: "FIXAS", valor: "194.96", substituta: { motivo: "OPEX", valor: "194.96" } }] });
      const dir = novoDir();
      expect(rodar([alterado.caminho, "--confirmar", "--hash-plano", revisado.sha, "--backup-dir", dir]).status).toBe(2);
      const errado = arquivoPlano({ ...PLANO, remover: [{ ...PLANO.remover[0], valor: "99.99" }, ...PLANO.remover.slice(1)] });
      expect(rodar([errado.caminho, "--confirmar", "--hash-plano", errado.sha, "--backup-dir", dir]).status).toBe(2);
      expect(await contar()).toBe(9);
      expect(readdirSync(dir)).toHaveLength(0);
    });

    it("sem SINCRONIZACAO_EXCLUSOES_HABILITADAS=1 o comando --corrigir --confirmar é RECUSADO (nada muda, nenhum backup)", async () => {
      await recriar();
      const { caminho, sha } = arquivoPlano();
      const dir = novoDir();
      const guardada = process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
      try {
        for (const valor of [undefined, "0", "true"]) {
          if (valor === undefined) delete process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
          else process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = valor;
          const r = rodar([caminho, "--confirmar", "--hash-plano", sha, "--backup-dir", dir]);
          expect(r.status).toBe(2);
          expect(r.stdout).toMatch(/SINCRONIZACAO_EXCLUSOES_HABILITADAS=1/);
        }
      } finally {
        process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = guardada;
      }
      expect(await contar()).toBe(9);
      expect(readdirSync(dir)).toHaveLength(0);
    });
    it("com hash e backup corretos grava exatamente os 3 IDs; repetir o comando é recusado sem excluir mais nada", async () => {
      await recriar();
      const { caminho, sha } = arquivoPlano();
      const dir = novoDir();
      const r = rodar([caminho, "--confirmar", "--hash-plano", sha, "--backup-dir", dir]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/CORREÇÃO GRAVADA: 3 registro/);
      expect(readdirSync(dir)).toHaveLength(1);
      expect(existsSync(join(dir, readdirSync(dir)[0]))).toBe(true);
      expect(await contar()).toBe(6);
      const ids = await idsPresentes();
      const r2 = rodar([caminho, "--confirmar", "--hash-plano", sha, "--backup-dir", dir]);
      expect(r2.status).toBe(2);
      expect(await idsPresentes()).toEqual(ids);
      expect(readdirSync(dir)).toHaveLength(1); // nenhum backup novo e nenhum sobrescrito
    });
  });
});
