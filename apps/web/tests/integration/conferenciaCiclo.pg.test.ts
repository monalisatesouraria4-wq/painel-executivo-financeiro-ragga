import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Conferência por CICLO (16→15) em PostgreSQL REAL, LOCAL e DESCARTÁVEL (PG_TESTE_URL → 127.0.0.1). Reproduz o defeito do painel:
 * várias "fontes" (uma por nome de arquivo) cobrem o MESMO ciclo e quase todas sem registros ligados — o resolvedor antigo escolhia uma
 * delas e a tela mostrava "sem dados". A consulta nova usa a data real dos registros. SQL real da migração 0000. Dados sintéticos.
 */
const URL_TESTE = process.env.PG_TESTE_URL ?? "";
const MIGRACOES = resolve(__dirname, "../../../../supabase/migrations");
const sqlDe = (arq: string) => readFileSync(resolve(MIGRACOES, arq), "utf-8").split(/-->\s*statement-breakpoint/).map((s) => s.trim()).filter(Boolean);

let sql: postgres.Sql;
let buscarConferenciaDoPeriodo: typeof import("@/lib/services/controlesCaixa").buscarConferenciaDoPeriodo;
let getDb: typeof import("@/lib/db/client").getDb;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe.skipIf(!URL_TESTE)("Conferência por ciclo — PostgreSQL descartável", () => {
  beforeAll(async () => {
    if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(URL_TESTE)) throw new Error("PG_TESTE_URL deve apontar para 127.0.0.1/localhost (banco descartável).");
    process.env.DATABASE_URL = URL_TESTE;
    sql = postgres(URL_TESTE, { max: 2 });
    ({ buscarConferenciaDoPeriodo } = await import("@/lib/services/controlesCaixa"));
    ({ getDb } = await import("@/lib/db/client"));
    await sql.unsafe("drop schema public cascade; create schema public;");
    for (const stmt of sqlDe("0000_schema_inicial.sql")) await sql.unsafe(stmt);
    const TODAS = ["BG 01", "BG 02", "BG 03", "BG 04", "BG 05", "BG 06", "BG 07", "BG 08 E 09", "BG 10", "BG 11", "BG 12", "BG 13", "IS 01", "IS 02", "IS 03", "ROBS", "MAPOLI"];
    await sql.unsafe(`insert into unidades (codigo, nome) values ${TODAS.map((c) => `('${c}','${c}')`).join(",")}`);

    // 6 fontes para o ciclo 16.09–15.10 (arquivos (10)…(15)); só a ÚLTIMA tem registros — e uma fonte do ciclo 16.08
    const fonte = async (arq: string, aba: string, ini: string, fim: string) => (await sql.unsafe("insert into fontes_por_periodo (tipo_base, arquivo_nome, nome_aba, periodo_inicio, periodo_fim) values ('conferencia',$1,$2,$3::date,$4::date) returning id::text", [arq, aba, ini, fim]))[0].id as string;
    const antigas: string[] = [];
    for (const n of [10, 11, 12, 13, 14]) antigas.push(await fonte(`CONTROLE (${n}).xlsx`, "16.09 a 15.10", "2026-09-16", "2026-10-15"));
    const f0915 = await fonte("CONTROLE (15).xlsx", "16.09 a 15.10", "2026-09-16", "2026-10-15");
    const f0809 = await fonte("CONTROLE (15).xlsx", "16.08 a 15.09", "2026-08-16", "2026-09-15");
    const linha = async (loja: string, data: string, cad: number, conf: number | null, atraso: boolean, fonteId: string) =>
      sql.unsafe("insert into conferencia (unidade_id, data, qtd_cadastrados, qtd_conferidos, em_atraso, resp_conferencia, fonte_periodo_id) values ((select id from unidades where codigo=$1), $2::date, $3, $4, $5, 'MONALISA', $6::uuid)", [loja, data, cad, conf, atraso, fonteId]);
    // ciclo 16.08–15.09 (histórico)
    await linha("BG 01", "2026-09-01", 5, 5, false, f0809);
    await linha("BG 01", "2026-09-15", 5, 4, false, f0809);
    // ciclo 16.09–15.10 — todos ligados à última fonte; um "X" (em atraso)
    await linha("BG 01", "2026-09-16", 5, 5, false, f0915);
    await linha("BG 01", "2026-10-07", 5, null, true, f0915); // "X": NÃO pode virar número
    await linha("BG 02", "2026-10-15", 4, 3, false, f0915);
    // cadastro CONHECIDO só de duas filiais que não têm conferência no ciclo 16.10 (registro mais antigo)
    await linha("BG 13", "2026-09-02", 4, 4, false, f0809);
    await linha("IS 01", "2026-09-02", 4, 4, false, f0809);
    // ciclo 16.10–15.11 — NENHUMA fonte cobre esse ciclo (cai numa fonte criada depois, sem período correspondente)
    const f1011 = await fonte("CONTROLE (19).xlsx", "16.10 a 15.11", "2026-10-16", "2026-11-15");
    await linha("BG 01", "2026-10-16", 5, 5, false, f1011);
    await linha("BG 01", "2026-10-18", 5, 2, false, f1011);
    await linha("BG 02", "2026-10-17", 4, 4, false, f1011);
    void antigas;
  });
  afterAll(async () => { await sql?.end(); });

  const chamar = (ref: string) => buscarConferenciaDoPeriodo(getDb(), d(ref));

  it("ciclo 16.09–15.10 aparece mesmo com 5 fontes vazias cobrindo o mesmo período (antes: 'sem dados')", async () => {
    const r = await chamar("2026-10-10");
    expect(r.disponivel).toBe(true);
    expect(r.linhas.filter((l) => !l.semRegistroNoPeriodo).map((l) => l.unidade).sort()).toEqual(["BG 01", "BG 02"]);
    expect(r.linhas).toHaveLength(17); // todas as filiais da rede aparecem
    expect(r.periodoInicio?.toISOString().slice(0, 10)).toBe("2026-09-16");
    expect(r.periodoFim?.toISOString().slice(0, 10)).toBe("2026-10-15");
    const dias = r.linhas.flatMap((l) => l.dias.map((x) => x.data.toISOString().slice(0, 10))).sort();
    expect(dias).toEqual(["2026-09-16", "2026-10-07", "2026-10-15"]); // só os dias do ciclo: nada do 16.08 nem do 16.10
  });

  it('o registro "X" continua "X": em atraso e SEM quantidade conferida', async () => {
    const r = await chamar("2026-10-10");
    const dia = r.linhas.find((l) => l.unidade === "BG 01")!.dias.find((x) => x.data.toISOString().slice(0, 10) === "2026-10-07")!;
    expect(dia.emAtraso).toBe(true);
    expect(dia.qtdConferidos).toBeNull();
  });

  it("ciclo atual 16.10–15.11 (data de hoje/qualquer dia do ciclo) mostra os dias 16–18/10", async () => {
    for (const ref of ["2026-10-16", "2026-10-22", "2026-11-15"]) {
      const r = await chamar(ref);
      expect(r.disponivel).toBe(true);
      const dias = r.linhas.flatMap((l) => l.dias.map((x) => x.data.toISOString().slice(0, 10))).sort();
      expect(dias).toEqual(["2026-10-16", "2026-10-17", "2026-10-18"]);
      expect(r.totalConferidosRede).toBe(2 + 4); // último dia de cada loja: BG 01 = 18/10 (2), BG 02 = 17/10 (4)
    }
  });

  it("TODAS as 17 filiais aparecem no ciclo; as sem conferência vêm com dias vazios e nenhuma quantidade inventada", async () => {
    const r = await chamar("2026-10-22");
    expect(r.linhas.map((l) => l.unidade).sort()).toEqual(["BG 01", "BG 02", "BG 03", "BG 04", "BG 05", "BG 06", "BG 07", "BG 08 E 09", "BG 10", "BG 11", "BG 12", "BG 13", "IS 01", "IS 02", "IS 03", "MAPOLI", "ROBS"].sort());
    expect(r.lojasSemRegistro).toHaveLength(15);
    const bg13 = r.linhas.find((l) => l.unidade === "BG 13")!;
    expect(bg13.semRegistroNoPeriodo).toBe(true);
    expect(bg13.dias).toEqual([]);
    expect(bg13.qtdConferidos).toBeNull();
    expect(bg13.qtdCadastrados).toBe(4); // cadastro do registro mais recente da filial (não é conferência)
    expect(r.linhas.find((l) => l.unidade === "ROBS")!.qtdCadastrados).toBeNull(); // sem nenhum registro no banco: cadastro DESCONHECIDO, não zero
    // sem cadastro conhecido para todas as filiais: o total de caixas cadastradas NÃO é calculado (nem completado com zeros)
    expect(r.totalCaixasCadastradasRede).toBeNull();
    // os totais de conferência continuam só sobre os registros reais
    expect(r.totalConferidosRede).toBe(6);
  });

  it("com o cadastro conhecido de todas as filiais, 'Caixas cadastradas' = Σ Qtd. caixas (cadastro ≠ soma diária de conferidos)", async () => {
    const cad: Record<string, number> = { "BG 03": 5, "BG 04": 5, "BG 05": 5, "BG 06": 4, "BG 07": 6, "BG 08 E 09": 3, "BG 10": 4, "BG 11": 4, "BG 12": 4, "IS 02": 2, "IS 03": 2, ROBS: 1, MAPOLI: 1 };
    const f = (await sql.unsafe("select id::text from fontes_por_periodo where nome_aba='16.08 a 15.09' limit 1"))[0].id as string;
    for (const [loja, q] of Object.entries(cad)) await sql.unsafe("insert into conferencia (unidade_id, data, qtd_cadastrados, qtd_conferidos, em_atraso, resp_conferencia, fonte_periodo_id) values ((select id from unidades where codigo=$1), '2026-09-02', $2, $2, false, 'MONALISA', $3::uuid)", [loja, q, f]);
    const r = await chamar("2026-10-22");
    // BG 01 = 5, BG 02 = 4 (último dia do ciclo anterior não conta: cadastro do ciclo atual), + demais acima, + BG 13 = 4, IS 01 = 4
    const soma = r.linhas.reduce((s, l) => s + (l.qtdCadastrados ?? 0), 0);
    expect(r.totalCaixasCadastradasRede).toBe(soma);
    expect(r.totalCaixasCadastradasRede).toBe(5 + 4 + 5 + 5 + 5 + 4 + 6 + 3 + 4 + 4 + 4 + 4 + 4 + 2 + 2 + 1 + 1); // 63 (BG 02 = 4 neste cenário sintético)
    // 'conferidos' do ciclo continua sendo a soma dos dias lançados, não o cadastro
    expect(r.totalConferidosRede).toBe(6);
  });

  it("ciclo histórico 16.08–15.09 continua separado, e o limite 15→16 não mistura ciclos", async () => {
    const hist = await chamar("2026-09-15");
    const diasHist = hist.linhas.flatMap((l) => l.dias.map((x) => x.data.toISOString().slice(0, 10)));
    expect(diasHist.every((x) => x >= "2026-08-16" && x <= "2026-09-15")).toBe(true); // só dias do ciclo histórico
    expect(diasHist).toEqual(expect.arrayContaining(["2026-09-01", "2026-09-15"]));
    const prox = await chamar("2026-09-16");
    expect(prox.linhas.flatMap((l) => l.dias.map((x) => x.data.toISOString().slice(0, 10))).sort()).toEqual(["2026-09-16", "2026-10-07", "2026-10-15"]);
  });

  it("ciclo sem registros: 'sem dados' (nada é inventado nem buscado em outro ciclo)", async () => {
    const r = await chamar("2026-12-20"); // ciclo 16.12–15.01
    expect(r.disponivel).toBe(false);
    expect(r.linhas).toEqual([]);
  });

  it("a consulta NÃO grava nada (contagem e conteúdo idênticos antes e depois)", async () => {
    const hash = async () => (await sql.unsafe("select count(*)::int n, md5(string_agg(to_jsonb(c)::text, ',' order by c.id)) h from conferencia c"))[0];
    const antes = await hash();
    for (const ref of ["2026-09-01", "2026-10-10", "2026-10-22", "2026-12-20"]) await chamar(ref);
    expect(await hash()).toEqual(antes);
  });
});
