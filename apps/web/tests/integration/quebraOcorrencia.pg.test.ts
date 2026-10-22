import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { numerarOcorrenciasQuebra } from "@/lib/import/ocorrenciaQuebra";
import type { RegistroBase } from "@/lib/import/tipos";

/**
 * Quebra de Caixa — identificação por OCORRÊNCIA, em PostgreSQL REAL, LOCAL e DESCARTÁVEL (PG_TESTE_URL → 127.0.0.1/descartavel).
 * Usa o SQL REAL das migrações 0000 e 0004 do projeto. Dados 100% sintéticos. Recusa qualquer outro destino.
 */
const URL_TESTE = process.env.PG_TESTE_URL ?? "";
const MIGRACOES = resolve(__dirname, "../../../../supabase/migrations");
const sqlDe = (arq: string) => readFileSync(resolve(MIGRACOES, arq), "utf-8").split(/-->\s*statement-breakpoint/).map((s) => s.trim()).filter(Boolean);

let sql: postgres.Sql;
let sqlMigracao: postgres.Sql; // conexão única: o arquivo da migração tem BEGIN/COMMIT próprios
let persistirQuebraCaixa: typeof import("@/lib/db/persistencia").persistirQuebraCaixa;
let buscarQuebraCaixaDoPeriodo: typeof import("@/lib/services/controlesCaixa").buscarQuebraCaixaDoPeriodo;
let buscarQuebraCaixaDoIntervalo: typeof import("@/lib/services/controlesCaixa").buscarQuebraCaixaDoIntervalo;
let getDb: typeof import("@/lib/db/client").getDb;

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const reg = (unidade: string, data: string, valor: number, operador: string, motivo: string, linhaOrigem: number): RegistroBase => ({
  unidade: unidade as RegistroBase["unidade"], data: d(data), valor, linhaOrigem,
  extras: { conferente: "MONALISA", operador, cpf: "111", motivo },
});
const FONTE = { arquivoNome: "teste.xlsx", nomeAba: "QUEBRA 16-09 A 15-10", periodoInicio: d("2026-09-16"), periodoFim: d("2026-10-15") };
const grava = (rs: RegistroBase[]) => persistirQuebraCaixa(numerarOcorrenciasQuebra(rs), FONTE);
const linhasBanco = async () => (await sql.unsafe("select u.codigo c, q.data::text d, q.operador, q.ocorrencia, q.valor::numeric(14,2)::text v from quebra_caixa q join unidades u on u.id=q.unidade_id order by 1,2,3,4,5")).map((r) => `${r.c}|${r.d}|${r.operador}|${r.ocorrencia}|${r.v}`);

async function recriarSchemaAntigo(): Promise<void> {
  await sql.unsafe("drop schema public cascade; create schema public;");
  for (const stmt of sqlDe("0000_schema_inicial.sql")) await sql.unsafe(stmt);
  await sql.unsafe("insert into unidades (codigo, nome) values ('BG 01','BG 01'),('BG 07','BG 07') on conflict do nothing");
}
const aplicarMigracao = async () => { await sqlMigracao.unsafe(readFileSync(resolve(MIGRACOES, "0004_quebra_caixa_ocorrencia.sql"), "utf-8")); };

describe.skipIf(!URL_TESTE)("Quebra de Caixa por ocorrência — PostgreSQL descartável", () => {
  beforeAll(async () => {
    if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(URL_TESTE)) throw new Error("PG_TESTE_URL deve apontar para 127.0.0.1/localhost (banco descartável).");
    process.env.DATABASE_URL = URL_TESTE;
    sql = postgres(URL_TESTE, { max: 2 });
    sqlMigracao = postgres(URL_TESTE, { max: 1 });
    ({ persistirQuebraCaixa } = await import("@/lib/db/persistencia"));
    ({ buscarQuebraCaixaDoPeriodo, buscarQuebraCaixaDoIntervalo } = await import("@/lib/services/controlesCaixa"));
    ({ getDb } = await import("@/lib/db/client"));
    await recriarSchemaAntigo();
  });
  afterAll(async () => { await sql?.end(); await sqlMigracao?.end(); });

  it("SEM a migração 0004 a gravação é RECUSADA (nada é escrito)", async () => {
    await expect(grava([reg("BG 07", "2026-10-04", 6.5, "OPERADORA UM", "ERRO DE DESPACHO", 55)])).rejects.toThrow(/Migração 0004/);
    expect(Number((await sql.unsafe("select count(*)::int n from quebra_caixa"))[0].n)).toBe(0);
  });

  it("MIGRAÇÃO sobre dados existentes: preserva todas as linhas (ocorrencia = 1), troca a restrição única e é idempotente", async () => {
    // estado "como produção": uma linha por chave natural (as repetições legítimas já haviam sido somadas em uma)
    const [f] = await sql.unsafe("insert into fontes_por_periodo (tipo_base, arquivo_nome, nome_aba, periodo_inicio, periodo_fim) values ('quebra_caixa','antigo.xlsx','QUEBRA 16-09 A 15-10','2026-09-16','2026-10-15') returning id");
    for (const [u, dt, op, mo, v] of [["BG 07", "2026-10-04", "OPERADORA UM", "ERRO DE DESPACHO", "6.50"], ["BG 07", "2026-09-27", "OPERADOR DOIS", "ERRO DE DESPACHO", "7.00"], ["BG 01", "2026-09-07", "OPERADORA TRES", "BRINDE", "6.50"]]) {
      await sql.unsafe("insert into quebra_caixa (unidade_id, data, conferente, operador, cpf, motivo, valor, fonte_periodo_id) values ((select id from unidades where codigo=$1), $2::date, 'MONALISA', $3, '111', $4, $5::numeric, $6::uuid)", [u, dt, op, mo, v, f.id]);
    }
    const semOcorrencia = async () => (await sql.unsafe("select u.codigo c, q.data::text d, q.operador, q.valor::numeric(14,2)::text v from quebra_caixa q join unidades u on u.id=q.unidade_id order by 1,2,3,4")).map((r) => `${r.c}|${r.d}|${r.operador}|${r.v}`);
    const antes = await semOcorrencia(); // a coluna ainda não existe
    await aplicarMigracao();
    const depois = await linhasBanco();
    expect(depois.length).toBe(antes.length);
    expect(depois.every((l) => l.split("|")[3] === "1")).toBe(true);
    expect(depois.map((l) => l.split("|").filter((_, i) => i !== 3).join("|"))).toEqual(antes); // nenhum dado mudou
    const [c] = await sql.unsafe("select pg_get_constraintdef(oid) d from pg_constraint where conname='quebra_caixa_chave'");
    expect(c.d).toContain("ocorrencia");
    await aplicarMigracao(); // idempotente
    expect(await linhasBanco()).toEqual(depois);
  });

  it("recupera as ocorrências repetidas: 5×R$6,50 e 2×R$7,00 ficam como registros separados; o que já existia é MANTIDO (nada é excluído)", async () => {
    const lote = [
      ...[55, 56, 57, 58, 59].map((l) => reg("BG 07", "2026-10-04", 6.5, "OPERADORA UM", "ERRO DE DESPACHO", l)),
      reg("BG 07", "2026-09-27", 7, "OPERADOR DOIS", "ERRO DE DESPACHO", 29), reg("BG 07", "2026-09-27", 7, "OPERADOR DOIS", "ERRO DE DESPACHO", 30),
      reg("BG 01", "2026-09-07", 55.3, "OPERADORA TRES", "BRINDE", 120), reg("BG 01", "2026-09-07", 6.5, "OPERADORA TRES", "BRINDE", 121),
    ];
    const r = await grava(lote);
    expect(r.inseridos).toBe(4 + 1 + 1); // 4 (Ana: ocorr. 2–5) + 1 (Jaime: ocorr. 2) + 1 (Michele 55,30: ocorr. 2)
    expect(r.atualizados).toBe(3); // as 3 ocorrências 1 que já existiam (upsert pela chave)
    const bd = await linhasBanco();
    expect(bd.filter((l) => l.startsWith("BG 07|2026-10-04|OPERADORA UM")).length).toBe(5);
    expect(bd.filter((l) => l.startsWith("BG 07|2026-09-27|OPERADOR DOIS")).length).toBe(2);
    expect(bd.filter((l) => l.startsWith("BG 01|2026-09-07|OPERADORA TRES")).map((l) => l.split("|")[4]).sort()).toEqual(["55.30", "6.50"]);
    const [t] = await sql.unsafe("select coalesce(sum(valor),0)::numeric(14,2)::text v from quebra_caixa");
    expect(t.v).toBe((5 * 6.5 + 2 * 7 + 55.3 + 6.5).toFixed(2));
  });

  it("REIMPORTAR o mesmo arquivo não duplica nada (0 inseridos; contagem e totais iguais)", async () => {
    const antes = await linhasBanco();
    const lote = [
      ...[55, 56, 57, 58, 59].map((l) => reg("BG 07", "2026-10-04", 6.5, "OPERADORA UM", "ERRO DE DESPACHO", l)),
      reg("BG 07", "2026-09-27", 7, "OPERADOR DOIS", "ERRO DE DESPACHO", 29), reg("BG 07", "2026-09-27", 7, "OPERADOR DOIS", "ERRO DE DESPACHO", 30),
      reg("BG 01", "2026-09-07", 55.3, "OPERADORA TRES", "BRINDE", 120), reg("BG 01", "2026-09-07", 6.5, "OPERADORA TRES", "BRINDE", 121),
    ];
    const r = await grava(lote);
    expect(r.inseridos).toBe(0);
    expect(await linhasBanco()).toEqual(antes);
  });

  it("REORDENAR as linhas da planilha (e mudar os números de linha) não cria nem altera nada", async () => {
    const antes = await linhasBanco();
    const lote = [
      reg("BG 01", "2026-09-07", 6.5, "OPERADORA TRES", "BRINDE", 900), reg("BG 01", "2026-09-07", 55.3, "OPERADORA TRES", "BRINDE", 10),
      reg("BG 07", "2026-09-27", 7, "OPERADOR DOIS", "ERRO DE DESPACHO", 77), reg("BG 07", "2026-09-27", 7, "OPERADOR DOIS", "ERRO DE DESPACHO", 3),
      ...[8, 6, 4, 2, 1].map((l) => reg("BG 07", "2026-10-04", 6.5, "OPERADORA UM", "ERRO DE DESPACHO", l)),
    ];
    const r = await grava(lote);
    expect(r.inseridos).toBe(0);
    expect(await linhasBanco()).toEqual(antes);
  });

  it("CORREÇÃO DE VALOR atualiza a mesma ocorrência (não cria registro novo)", async () => {
    const antes = await linhasBanco();
    const lote = [
      ...[55, 56, 57, 58].map((l) => reg("BG 07", "2026-10-04", 6.5, "OPERADORA UM", "ERRO DE DESPACHO", l)),
      reg("BG 07", "2026-10-04", 9, "OPERADORA UM", "ERRO DE DESPACHO", 59), // a 5ª passou a valer 9,00
    ];
    const r = await grava(lote);
    expect(r.inseridos).toBe(0);
    const dep = await linhasBanco();
    expect(dep.length).toBe(antes.length);
    expect(dep.filter((l) => l.startsWith("BG 07|2026-10-04|OPERADORA UM")).map((l) => l.split("|")[4]).sort()).toEqual(["6.50", "6.50", "6.50", "6.50", "9.00"]);
  });

  it("INCLUSÃO de uma ocorrência acrescenta exatamente 1 registro; REMOÇÃO deixa o excedente no banco (upsert nunca exclui)", async () => {
    const base = [
      ...[55, 56, 57, 58].map((l) => reg("BG 07", "2026-10-04", 6.5, "OPERADORA UM", "ERRO DE DESPACHO", l)),
      reg("BG 07", "2026-10-04", 9, "OPERADORA UM", "ERRO DE DESPACHO", 59),
    ];
    const r1 = await grava([...base, reg("BG 07", "2026-10-04", 6.5, "OPERADORA UM", "ERRO DE DESPACHO", 60)]); // 6ª ocorrência
    expect(r1.inseridos).toBe(1);
    const n6 = (await linhasBanco()).filter((l) => l.startsWith("BG 07|2026-10-04|OPERADORA UM")).length;
    expect(n6).toBe(6);
    const r2 = await grava(base.slice(0, 4)); // a planilha agora tem só 4 — nada é apagado do banco
    expect(r2.inseridos).toBe(0);
    expect((await linhasBanco()).filter((l) => l.startsWith("BG 07|2026-10-04|OPERADORA UM")).length).toBe(6);
  });

  it("totais por data e por ciclo no banco = soma dos lançamentos; consultas do painel respeitam a data real", async () => {
    const [t] = await sql.unsafe("select coalesce(sum(valor),0)::numeric(14,2)::text v from quebra_caixa where data between '2026-10-04' and '2026-10-04'");
    const db = getDb();
    const iv = await buscarQuebraCaixaDoIntervalo(db, d("2026-10-04"), d("2026-10-04"));
    expect(iv.disponivel).toBe(true);
    expect(iv.totalGeral).toBe(Number(t.v));
    const sem = await buscarQuebraCaixaDoIntervalo(db, d("2026-10-05"), d("2026-10-05"));
    expect(sem.disponivel).toBe(false); // sem lançamentos na data: "sem dados", nunca o dia anterior
    const ciclo = await buscarQuebraCaixaDoPeriodo(db, d("2026-10-10"));
    expect(ciclo.disponivel).toBe(true);
    const [c] = await sql.unsafe("select coalesce(sum(valor),0)::numeric(14,2)::text v, count(*)::int n from quebra_caixa where data between '2026-09-16' and '2026-10-15'");
    expect(ciclo.totalGeral).toBe(Number(c.v));
    expect(ciclo.detalhado.length).toBe(c.n);
  });

  it("IDENTIDADE preservada na correção de valor (mesmos ids): corrigir a de R$ 9,00 para R$ 5,00 altera SÓ a ocorrência 3", async () => {
    const lote = (v3: number) => [reg("BG 01", "2026-10-20", 6.5, "OPERADOR QUATRO", "ERRO DE DESPACHO", 1), reg("BG 01", "2026-10-20", 6.5, "OPERADOR QUATRO", "ERRO DE DESPACHO", 2), reg("BG 01", "2026-10-20", v3, "OPERADOR QUATRO", "ERRO DE DESPACHO", 3)];
    await grava(lote(9));
    const ler = async () => Object.fromEntries((await sql.unsafe("select ocorrencia, id::text, valor::numeric(14,2)::text v from quebra_caixa where operador='OPERADOR QUATRO' order by ocorrencia")).map((r) => [r.ocorrencia, `${r.id}|${r.v}`]));
    const antes = await ler();
    const r = await grava(lote(5)); // a de 9,00 foi corrigida para 5,00 (a ordenação por valor SOZINHA trocaria as ocorrências 1 e 3)
    expect(r.inseridos).toBe(0);
    const depois = await ler();
    expect(Object.keys(depois)).toEqual(["1", "2", "3"]);
    expect(depois[1]).toBe(antes[1]); // mesmo id e mesmo valor
    expect(depois[2]).toBe(antes[2]);
    expect(depois[3].split("|")[0]).toBe(antes[3].split("|")[0]); // mesmo id
    expect(antes[3].split("|")[1]).toBe("9.00");
    expect(depois[3].split("|")[1]).toBe("5.00"); // só o valor da ocorrência 3 mudou
  });

  it("ROLLBACK documentado só é possível enquanto nenhuma ocorrencia > 1 existe (a restrição antiga seria violada)", async () => {
    await expect(sql.unsafe('ALTER TABLE "quebra_caixa" DROP CONSTRAINT "quebra_caixa_chave"; ALTER TABLE "quebra_caixa" ADD CONSTRAINT "quebra_caixa_chave" UNIQUE("unidade_id","data","conferente","operador","cpf","motivo")')).rejects.toThrow();
  });
});
