import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compactarLote, type LoteCompacto } from "@/lib/import/loteCompacto";
import { baseSnapshot } from "@/lib/import/basesSnapshot";
import type { RegistroBase } from "@/lib/import/tipos";

/**
 * As Server Actions da TELA DE IMPORTAÇÃO (`lib/actions/sincronizacaoBases.ts`) contra um PostgreSQL LOCAL e DESCARTÁVEL
 * (PG_TESTE_URL → 127.0.0.1/descartavel). Prova que a interface não consegue contornar os bloqueios do mecanismo.
 */
const URL_TESTE = process.env.PG_TESTE_URL ?? "";
let sql: postgres.Sql;
const dirs: string[] = [];
const novoDir = () => { const d = mkdtempSync(join(tmpdir(), "acoes-")); dirs.push(d); return d; };
let acoesReais: typeof import("@/lib/actions/sincronizacaoBases");
/** Adaptador de teste: os casos abaixo descrevem o lote como RegistroBase; a ação real recebe o formato COMPACTO. */
type EntradaTeste = Omit<Parameters<typeof import("@/lib/actions/sincronizacaoBases").previsualizarSincronizacaoBase>[0], "registros"> & { registros: RegistroBase[] };
const compacta = (e: EntradaTeste) => ({ ...e, registros: (baseSnapshot(e.base) ? compactarLote(e.base, e.registros) : []) as LoteCompacto });
const acoes = {
  previsualizarSincronizacaoBase: (e: EntradaTeste) => acoesReais.previsualizarSincronizacaoBase(compacta(e)),
  confirmarSincronizacaoBase: (e: EntradaTeste & { hashPlanoAprovado?: string; confirmacaoExclusao?: string }) => acoesReais.confirmarSincronizacaoBase({ ...e, registros: compacta(e).registros }),
};
let persistirBase: typeof import("@/lib/actions/persistirBase");
let backupDir = "";

async function recriar() {
  await sql.unsafe("drop schema public cascade; create schema public;");
  await sql.unsafe("create table unidades (id uuid primary key default gen_random_uuid(), codigo text unique not null, nome text)");
  const tabelas: Array<[string, string[]]> = [["faturamento", []], ["brindes", ["motivo", "motivo2"]], ["cancelamento_salao", ["motivo"]], ["cancelamento_delivery", ["motivo"]], ["compra_direta", ["motivo"]], ["retirada_deposito", ["caixa", "motivo", "motivo_descricao", "usuario", "usuario_autorizador"]]];
  for (const [t, cols] of tabelas) {
    const defs = cols.map((c) => `${c} text not null default ''`).join(", ");
    await sql.unsafe(`create table ${t} (id uuid primary key default gen_random_uuid(), unidade_id uuid not null references unidades(id), data date not null, importacao_id uuid,
      criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(), ${defs}${defs ? "," : ""} valor numeric(14,2) not null, unique (unidade_id, data${cols.map((c) => `, ${c}`).join("")}))`);
  }
  await sql.unsafe("insert into unidades (codigo, nome) values ('BG 01','BG 01'),('BG 02','BG 02')");
}
const cd = (unidade: string, data: string, motivo: string, valor: number): RegistroBase => ({ unidade: unidade as RegistroBase["unidade"], data: new Date(`${data}T00:00:00.000Z`), valor, extras: { motivo }, linhaOrigem: 0 });
const compra = async (unidade: string, data: string, motivo: string, valor: string) => (await sql`insert into compra_direta (unidade_id, data, motivo, valor) select id, ${data}::date, ${motivo}, ${valor}::numeric from unidades where codigo = ${unidade} returning id::text`)[0].id as string;
const contar = async (t = "compra_direta") => Number((await sql.unsafe(`select count(*)::int n from ${t}`))[0].n);
const hash = async () => (await sql.unsafe("select md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) h from compra_direta x"))[0].h as string;

describe.skipIf(!URL_TESTE)("ações da tela de importação — PostgreSQL LOCAL descartável", () => {
  beforeAll(async () => {
    const u = new URL(URL_TESTE);
    expect(["127.0.0.1", "localhost"]).toContain(u.hostname);
    expect(URL_TESTE).not.toMatch(/supabase|pooler|amazonaws|neon\.tech/i);
    expect(URL_TESTE).not.toBe(process.env.DATABASE_URL ?? "__sem__");
    expect(u.pathname).toBe("/descartavel");
    process.env.DATABASE_URL = URL_TESTE; // só neste processo de teste, apontando para o banco descartável
    backupDir = novoDir();
    process.env.SINCRONIZACAO_BACKUP_DIR = backupDir;
    process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = "1"; // opt-in explícito (o padrão é BLOQUEADO)
    sql = postgres(URL_TESTE, { max: 1, ssl: false, onnotice: () => {} });
    acoesReais = await import("@/lib/actions/sincronizacaoBases");
    persistirBase = await import("@/lib/actions/persistirBase");
  });
  afterAll(async () => {
    await sql?.end();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  async function cenario() {
    await recriar();
    await compra("BG 01", "2026-10-01", "OPEX", "10.00");
    const idAntigo = await compra("BG 01", "2026-10-01", "FIXAS", "4.00");
    return { fonte: [cd("BG 01", "2026-10-01", "OPEX", 10), cd("BG 01", "2026-10-02", "CMV", 5)], idAntigo };
  }

  it("a prévia é somente leitura e devolve o plano (hash, riscos, removíveis, flags do ambiente)", async () => {
    const { fonte, idAntigo } = await cenario();
    const antes = await hash();
    const p = await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte });
    expect(p.conectado).toBe(true);
    if (!p.conectado) return;
    expect(p.exclusoesHabilitadas).toBe(true);
    expect(p.backupDisponivel).toBe(true);
    expect([p.plano.novosTotal, p.plano.iguais, p.plano.removiveisTotal]).toEqual([1, 1, 1]);
    expect(p.plano.removiveis[0].id).toBe(idAntigo);
    expect(p.plano.hashPlano).toMatch(/^[0-9a-f]{64}$/);
    expect(await hash()).toBe(antes);
  });

  it("sem DATABASE_URL a prévia devolve conectado:false (a tela cai no fluxo da sessão do navegador)", async () => {
    const { fonte } = await cenario();
    const guardada = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte })).toEqual({ conectado: false });
    } finally {
      process.env.DATABASE_URL = guardada;
    }
  });

  it("entradas inválidas são recusadas: base sem sincronização, lote vazio, unidade/data/valor/chave inválidos, formato antigo", async () => {
    await cenario();
    const ok = ["BG 01", "2026-10-01", 100, "OPEX"];
    const prev = (base: string, registros: unknown) => acoesReais.previsualizarSincronizacaoBase({ base, registros: registros as LoteCompacto });
    await expect(prev("troco", [ok])).rejects.toThrow(/sem sincronização autoritativa/);
    await expect(prev("compraDireta", [])).rejects.toThrow(/Lote inválido/);
    await expect(prev("compraDireta", "texto")).rejects.toThrow(/Lote inválido/);
    await expect(prev("compraDireta", [["XX 99", "2026-10-01", 100, "OPEX"]])).rejects.toThrow(/registro inválido/);
    await expect(prev("compraDireta", [["BG 01", "2026-10-01T13:00:00Z", 100, "OPEX"]])).rejects.toThrow(/registro inválido/);
    await expect(prev("compraDireta", [["BG 01", "2026-02-30", 100, "OPEX"]])).rejects.toThrow(/registro inválido/);
    await expect(prev("compraDireta", [["BG 01", "2026-10-01", 10.5, "OPEX"]])).rejects.toThrow(/registro inválido/); // centavos fracionados
    await expect(prev("compraDireta", [["BG 01", "2026-10-01", Number.NaN, "OPEX"]])).rejects.toThrow(/registro inválido/);
    await expect(prev("compraDireta", [["BG 01", "2026-10-01", 100]])).rejects.toThrow(/registro inválido/); // falta o campo de chave
    await expect(prev("compraDireta", [["BG 01", "2026-10-01", 100, "OPEX", "EXTRA"]])).rejects.toThrow(/registro inválido/);
    await expect(prev("compraDireta", [["BG 01", "2026-10-01", 100, 5]])).rejects.toThrow(/registro inválido/);
    await expect(prev("compraDireta", [{ unidade: "BG 01", data: "2026-10-01", valor: 1, extras: { motivo: "X" } }])).rejects.toThrow(/registro inválido/); // formato antigo (objetos) não é aceito
  });

  it("o upsert antigo (persistirBaseNoBanco) recusa as bases com sincronização autoritativa: não há atalho", async () => {
    await cenario();
    for (const id of ["faturamento", "brindes", "cancelamentoSalao", "cancelamentoDelivery", "compraDireta", "retiradaDeposito"] as const) {
      await expect(persistirBase.persistirBaseNoBanco(id, [cd("BG 01", "2026-10-01", "X", 1)])).rejects.toThrow(/sincronização autoritativa/);
    }
  });

  it("exclusão: sem texto de confirmação, com texto errado ou com hash errado NADA é gravado", async () => {
    const { fonte } = await cenario();
    const antes = await hash();
    const p = await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte });
    if (!p.conectado) throw new Error("sem banco");
    const hashOk = p.plano.hashPlano;
    const base = { base: "compraDireta", registros: fonte };
    expect((await acoes.confirmarSincronizacaoBase({ ...base, hashPlanoAprovado: hashOk })).status).toBe("bloqueado");
    expect((await acoes.confirmarSincronizacaoBase({ ...base, hashPlanoAprovado: hashOk, confirmacaoExclusao: "EXCLUIR 2" })).status).toBe("bloqueado");
    const hashErrado = await acoes.confirmarSincronizacaoBase({ ...base, hashPlanoAprovado: "0".repeat(64), confirmacaoExclusao: "EXCLUIR 1" });
    expect(hashErrado.status).toBe("bloqueado");
    expect(await hash()).toBe(antes);
    expect(readdirSync(backupDir)).toHaveLength(0);
  });

  it.each([[undefined], ["0"], [""], ["true"], ["yes"], [" 1"]])("exclusões opt-in: com SINCRONIZACAO_EXCLUSOES_HABILITADAS=%j a ação BLOQUEIA mesmo com hash, texto e backup corretos", async (valor) => {
    const { fonte } = await cenario();
    const antes = await hash();
    const p = await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte });
    if (!p.conectado) throw new Error("sem banco");
    expect(p.exclusoesHabilitadas).toBe(true); // com "1" a prévia indica habilitado
    const guardada = process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
    if (valor === undefined) delete process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
    else process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = valor;
    try {
      const prev = await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte });
      expect(prev.conectado && prev.exclusoesHabilitadas).toBe(false); // a TELA recebe a flag desligada
      const r = await acoes.confirmarSincronizacaoBase({ base: "compraDireta", registros: fonte, hashPlanoAprovado: p.plano.hashPlano, confirmacaoExclusao: "EXCLUIR 1" });
      expect(r.status).toBe("bloqueado");
      if (r.status === "bloqueado") expect(r.motivo).toMatch(/SINCRONIZACAO_EXCLUSOES_HABILITADAS=1/);
      expect((await acoes.confirmarSincronizacaoBase({ base: "compraDireta", registros: fonte, hashPlanoAprovado: p.plano.hashPlano })).status).toBe("bloqueado");
    } finally {
      process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = guardada;
    }
    expect(await hash()).toBe(antes);
    expect(readdirSync(backupDir)).toHaveLength(0);
  });

  it("sem a variável, gravar sem exclusão pela ação continua funcionando (novos entram, nada é removido)", async () => {
    const { fonte } = await cenario();
    const guardada = process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
    delete process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS;
    try {
      const pp = await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte, opcoes: { semExclusao: true } });
      if (!pp.conectado) throw new Error("sem banco");
      const r = await acoes.confirmarSincronizacaoBase({ base: "compraDireta", registros: fonte, opcoes: { semExclusao: true }, hashPlanoAprovado: pp.plano.hashPlano });
      expect(r.status).toBe("gravado");
    } finally {
      process.env.SINCRONIZACAO_EXCLUSOES_HABILITADAS = guardada;
    }
    expect(await contar()).toBe(3); // 2 do cenário + 1 novo; o antigo FIXAS foi PRESERVADO
  });

  it("com hash, confirmação digitada e backup: grava o plano aprovado (exclui só o ID previsto) e grava o backup completo", async () => {
    const { fonte, idAntigo } = await cenario();
    const p = await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte });
    if (!p.conectado) throw new Error("sem banco");
    const r = await acoes.confirmarSincronizacaoBase({ base: "compraDireta", registros: fonte, hashPlanoAprovado: p.plano.hashPlano, confirmacaoExclusao: "EXCLUIR 1" });
    expect(r.status).toBe("gravado");
    if (r.status !== "gravado") return;
    expect([r.inseridos, r.atualizados, r.removidos]).toEqual([1, 0, 1]);
    expect(r.totalNoEscopoDepois).toEqual({ chaves: 2, centavos: 1500 });
    expect(await contar()).toBe(2);
    const bk = JSON.parse(readFileSync(r.backup!, "utf-8"));
    expect(bk.removidos.map((x: { id: string }) => x.id)).toEqual([idAntigo]);
    expect(readdirSync(backupDir)).toHaveLength(1);
    // reexecução: nada pendente
    const p2 = await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte });
    expect(p2.conectado && [p2.plano.novosTotal, p2.plano.alteradosTotal, p2.plano.removiveisTotal]).toEqual([0, 0, 0]);
  });

  it("o hash aprovado pela tela é a única autorização: se o banco mudar depois da prévia, a gravação é recusada", async () => {
    const { fonte } = await cenario();
    const p = await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte });
    if (!p.conectado) throw new Error("sem banco");
    await compra("BG 01", "2026-10-01", "CHEGOU_DEPOIS", "7.00"); // outra sessão altera o escopo depois da prévia
    const r = await acoes.confirmarSincronizacaoBase({ base: "compraDireta", registros: fonte, hashPlanoAprovado: p.plano.hashPlano, confirmacaoExclusao: "EXCLUIR 1" });
    expect(r.status === "bloqueado" || r.status === "revertido").toBe(true);
    expect(await contar()).toBe(3);
  });

  it("loja ausente do arquivo: a interface não consegue excluir; 'preservar' grava só novos/alterados", async () => {
    const { fonte } = await cenario();
    await sql`insert into compra_direta (unidade_id, data, motivo, valor) select id, date '2026-10-01', 'OPEX', 50 from unidades where codigo = 'BG 02'`; // BG 02 não está no arquivo
    const p = await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte });
    if (!p.conectado) throw new Error("sem banco");
    expect(p.plano.riscos.map((x) => x.codigo)).toContain("LOJA_AUSENTE_NO_ARQUIVO");
    expect(p.plano.podeGravar).toBe(false);
    const bloq = await acoes.confirmarSincronizacaoBase({ base: "compraDireta", registros: fonte, hashPlanoAprovado: p.plano.hashPlano, confirmacaoExclusao: "EXCLUIR 1" });
    expect(bloq.status).toBe("bloqueado");
    expect(await contar()).toBe(3);
    const pp = await acoes.previsualizarSincronizacaoBase({ base: "compraDireta", registros: fonte, opcoes: { semExclusao: true } });
    if (!pp.conectado) throw new Error("sem banco");
    const ok = await acoes.confirmarSincronizacaoBase({ base: "compraDireta", registros: fonte, opcoes: { semExclusao: true }, hashPlanoAprovado: pp.plano.hashPlano });
    expect(ok.status).toBe("gravado");
    expect(await contar()).toBe(4); // +1 novo; nenhum antigo removido
  });

  it("Faturamento: novos dias entram sem exclusão e sem alterar o histórico", async () => {
    await recriar();
    await sql`insert into faturamento (unidade_id, data, valor) select id, date '2026-10-01', 100 from unidades where codigo = 'BG 01'`;
    const fonte = [
      { unidade: "BG 01", data: new Date("2026-10-01T00:00:00.000Z"), valor: 100, extras: {}, linhaOrigem: 0 },
      { unidade: "BG 01", data: new Date("2026-10-02T00:00:00.000Z"), valor: 120, extras: {}, linhaOrigem: 0 },
    ] as RegistroBase[];
    const p = await acoes.previsualizarSincronizacaoBase({ base: "faturamento", registros: fonte });
    if (!p.conectado) throw new Error("sem banco");
    expect([p.plano.novosTotal, p.plano.iguais, p.plano.removiveisTotal]).toEqual([1, 1, 0]);
    const r = await acoes.confirmarSincronizacaoBase({ base: "faturamento", registros: fonte, hashPlanoAprovado: p.plano.hashPlano });
    expect(r.status).toBe("gravado");
    expect(await contar("faturamento")).toBe(2);
  });

  it("Retirada Depósito: linhas de outros motivos (SUPRIMENTO/ERRO) estão fora do escopo da fonte e NUNCA são candidatas a exclusão", async () => {
    await recriar();
    const ins = (motivo: string, valor: number) => sql`insert into retirada_deposito (unidade_id, data, caixa, motivo, valor) select id, date '2026-10-01', 'CX', ${motivo}, ${valor} from unidades where codigo = 'BG 01'`;
    await ins("DEPÓSITO", 10);
    await ins("SUPRIMENTO", 99);
    await ins("ERRO", 5);
    const fonte = [{ unidade: "BG 01", data: new Date("2026-10-01T00:00:00.000Z"), valor: 10, extras: { caixa: "CX", motivo: "DEPÓSITO", motivo_descricao: "", usuario: "", usuario_autorizador: "" }, linhaOrigem: 0 }] as RegistroBase[];
    const p = await acoes.previsualizarSincronizacaoBase({ base: "retiradaDeposito", registros: fonte });
    if (!p.conectado) throw new Error("sem banco");
    expect([p.plano.iguais, p.plano.novosTotal, p.plano.removiveisTotal]).toEqual([1, 0, 0]);
    expect(p.plano.bancoNoEscopo.chaves).toBe(1);
    const r = await acoes.confirmarSincronizacaoBase({ base: "retiradaDeposito", registros: fonte, hashPlanoAprovado: p.plano.hashPlano });
    expect(r.status).toBe("gravado");
    expect(await contar("retirada_deposito")).toBe(3); // SUPRIMENTO e ERRO preservados
  });
});
