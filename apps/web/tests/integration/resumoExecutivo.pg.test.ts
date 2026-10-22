import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Resumo Semanal Executivo — consulta em PostgreSQL REAL, LOCAL e DESCARTÁVEL (PG_TESTE_URL → 127.0.0.1). Confere que o período
 * consultado é EXATAMENTE a semana pedida (e a anterior), que os totais batem com o SQL direto, que a cobertura distingue zero real de
 * ausência de dados e que a consulta não grava nada. Schema real (migração 0000). Dados sintéticos.
 */
const URL_TESTE = process.env.PG_TESTE_URL ?? "";
const MIGRACOES = resolve(__dirname, "../../../../supabase/migrations");
const sqlDe = (arq: string) => readFileSync(resolve(MIGRACOES, arq), "utf-8").split(/-->\s*statement-breakpoint/).map((s) => s.trim()).filter(Boolean);

let sql: postgres.Sql;
let buscarResumoExecutivo: typeof import("@/lib/services/resumoExecutivo.server").buscarResumoExecutivo;
const SEMANA = { inicio: "2026-09-14", fim: "2026-09-20" }; // segunda → domingo (passada)

describe.skipIf(!URL_TESTE)("Resumo Semanal Executivo — PostgreSQL descartável", () => {
  beforeAll(async () => {
    if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(URL_TESTE)) throw new Error("PG_TESTE_URL deve apontar para 127.0.0.1/localhost (banco descartável).");
    process.env.DATABASE_URL = URL_TESTE;
    sql = postgres(URL_TESTE, { max: 2 });
    ({ buscarResumoExecutivo } = await import("@/lib/services/resumoExecutivo.server"));
    await sql.unsafe("drop schema public cascade; create schema public;");
    for (const stmt of sqlDe("0000_schema_inicial.sql")) await sql.unsafe(stmt);
    for (const stmt of sqlDe("0004_quebra_caixa_ocorrencia.sql").map((s) => s.replace(/^(BEGIN|COMMIT);$/gm, "").trim()).filter(Boolean)) await sql.unsafe(stmt);
    await sql.unsafe("insert into unidades (codigo, nome) values ('BG 01','BG 01'),('BG 02','BG 02')");
    const u = async (c: string) => (await sql.unsafe("select id::text from unidades where codigo=$1", [c]))[0].id as string;
    const [u1, u2] = [await u("BG 01"), await u("BG 02")];
    const ins = (tabela: string, cols: string, valores: unknown[]) => sql.unsafe(`insert into ${tabela} (${cols}) values (${valores.map((_, i) => `$${i + 1}`).join(",")})`, valores as never[]);

    // faturamento: todos os dias de 07/09 a 21/09 (21/09 fica FORA da semana consultada; 13/09 pertence à semana anterior)
    for (let d = 7; d <= 21; d++) await ins("faturamento", "unidade_id, data, valor", [u1, `2026-09-${String(d).padStart(2, "0")}`, 100]);
    // brindes / cancelamentos / compra direta (com NOTA FISCAL) / retirada / troco / quebra
    await ins("brindes", "unidade_id, data, valor, motivo, motivo2", [u1, "2026-09-14", 30, "BRINDE PRESENTE", ""]);
    await ins("brindes", "unidade_id, data, valor, motivo, motivo2", [u2, "2026-09-20", 70, "BRINDE CONSUMO", ""]);
    await ins("brindes", "unidade_id, data, valor, motivo, motivo2", [u1, "2026-09-21", 999, "BRINDE FORA DA SEMANA", ""]); // 21/09: fora
    await ins("brindes", "unidade_id, data, valor, motivo, motivo2", [u1, "2026-09-13", 10, "BRINDE ANTERIOR", ""]); // 13/09: semana anterior
    await ins("brindes", "unidade_id, data, valor, motivo, motivo2", [u1, "2026-09-01", 1, "BRINDE ANTIGO", ""]); // amplia a cobertura da base para antes da semana anterior
    await ins("cancelamento_salao", "unidade_id, data, valor, motivo", [u1, "2026-09-15", 12.5, "MOT 01"]);
    await ins("cancelamento_delivery", "unidade_id, data, valor, motivo", [u2, "2026-09-16", 7.5, "MOT 02"]);
    await ins("compra_direta", "unidade_id, data, valor, motivo", [u1, "2026-09-17", 200, "CMV"]);
    await ins("compra_direta", "unidade_id, data, valor, motivo", [u1, "2026-09-17", 500, "NOTA FISCAL"]);
    await ins("retirada_deposito", "unidade_id, data, valor, caixa, motivo", [u1, "2026-09-18", 1000, "CX1", "DEPÓSITO"]);
    await ins("retirada_deposito", "unidade_id, data, valor, caixa, motivo", [u2, "2026-09-19", 400, "CX1", "DEPÓSITO"]);
    await ins("troco", "unidade_id, data, caixa, troco_conferido_gerente, troco_informado_colaborador, diferenca", [u1, "2026-09-16", "CX1", 100, 90, -10]);
    const f = (await sql.unsafe("insert into fontes_por_periodo (tipo_base, arquivo_nome, nome_aba, periodo_inicio, periodo_fim) values ('quebra_caixa','t.xlsx','Q','2026-08-16','2026-09-15') returning id::text"))[0].id as string;
    await ins("quebra_caixa", "unidade_id, data, valor, conferente, operador, cpf, motivo, ocorrencia, fonte_periodo_id", [u1, "2026-09-14", 6.5, "C", "OP", "1", "ERRO DE DESPACHO", 1, f]); // ciclo 16/08–15/09
    await ins("quebra_caixa", "unidade_id, data, valor, conferente, operador, cpf, motivo, ocorrencia, fonte_periodo_id", [u1, "2026-09-16", 3.5, "C", "OP", "1", "ERRO DE DESPACHO", 1, f]); // ciclo 16/09–15/10
    // linhas-marcador (valor 0) FORA das duas semanas (01/09 e 25/09): só estendem a cobertura (menor/maior data) de cada base
    for (const dia of ["2026-09-01", "2026-09-25"]) {
      await ins("cancelamento_salao", "unidade_id, data, valor, motivo", [u1, dia, 0, "MARCADOR"]);
      await ins("cancelamento_delivery", "unidade_id, data, valor, motivo", [u1, dia, 0, "MARCADOR"]);
      await ins("compra_direta", "unidade_id, data, valor, motivo", [u1, dia, 0, "MARCADOR"]);
      await ins("retirada_deposito", "unidade_id, data, valor, caixa, motivo", [u1, dia, 0, "CX9", "DEPÓSITO"]);
      await ins("troco", "unidade_id, data, caixa, troco_conferido_gerente, troco_informado_colaborador, diferenca", [u1, dia, "CX9", 0, 0, 0]);
      await ins("quebra_caixa", "unidade_id, data, valor, conferente, operador, cpf, motivo, ocorrencia, fonte_periodo_id", [u1, dia, 0, "C", "OP", "9", "MARCADOR", 1, f]);
      await ins("brindes", "unidade_id, data, valor, motivo, motivo2", [u1, dia, 0, "MARCADOR", ""]);
    }
    // formas de pagamento SÓ na semana anterior (até 13/09): a semana consultada NÃO tem cobertura
    await ins("formas_pagamento", "unidade_id, data, valor, forma", [u1, "2026-09-07", 5, "DINHEIRO"]);
    await ins("formas_pagamento", "unidade_id, data, valor, forma", [u1, "2026-09-10", 100, "CARTAO CREDITO"]);
    await ins("formas_pagamento", "unidade_id, data, valor, forma", [u1, "2026-09-13", 100, "PIX MAQUININHA"]);
  });
  afterAll(async () => { await sql?.end(); });

  it("o período consultado é exatamente a semana pedida: 14–20/09 (nada de 13/09 nem de 21/09) e totais batem com o SQL", async () => {
    const r = await buscarResumoExecutivo(SEMANA);
    expect(r.conectado).toBe(true);
    expect(r.resumo).not.toBeNull();
    const res = r.resumo!;
    expect(res.periodo).toEqual({ inicio: "2026-09-14", fim: "2026-09-20", rotulo: "14/09/2026 a 20/09/2026" });
    expect(res.anterior.rotulo).toBe("07/09/2026 a 13/09/2026");
    const t = (id: string) => res.totais.find((x) => x.id === id)!;
    expect(t("faturamento").atual.valor).toBe(700); // 7 dias × 100
    expect(t("faturamento").anterior.valor).toBe(700);
    expect(t("brindes").atual.valor).toBe(100); // 30 + 70 (999 de 21/09 fora; 10 de 13/09 é da anterior)
    expect(t("brindes").anterior.valor).toBe(10);
    expect(t("cancelamentoSalao").atual.valor).toBe(12.5);
    expect(t("cancelamentoDelivery").atual.valor).toBe(7.5);
    expect(t("cancelamentos").atual.valor).toBe(20);
    expect(t("compraDireta").atual.valor).toBe(200); // NOTA FISCAL (500) fora do total
    expect(res.detalhes.compraDireta.notaFiscal).toBe(500);
    expect(t("retiradaDeposito").atual.valor).toBe(1400);
    expect(res.detalhes.retiradaDeposito.porLoja).toEqual([{ unidade: "BG 01", valor: 1000 }, { unidade: "BG 02", valor: 400 }]);
    expect(t("troco").atual.valor).toBe(10); // falta de 10,00
    expect(t("quebra").atual.valor).toBe(10);
    expect(res.detalhes.quebra.porCiclo.map((c) => [c.inicio, c.valor])).toEqual([["2026-08-16", 6.5], ["2026-09-16", 3.5]]); // ciclo 16→15
    const [sqlBr] = await sql.unsafe("select sum(valor)::numeric(14,2)::text v from brindes where data between '2026-09-14' and '2026-09-20'");
    expect(Number(sqlBr.v)).toBe(t("brindes").atual.valor);
  });

  it("formas de pagamento sem cobertura na semana consultada = 'sem dados' (null), NUNCA zero", async () => {
    const res = (await buscarResumoExecutivo(SEMANA)).resumo!;
    const credito = res.formas.find((x) => x.id === "credito")!;
    expect(credito.atual.valor).toBeNull();
    expect(credito.atual.status).toBe("sem-dados");
    expect(credito.atual.nota).toBe("Formas de pagamento: a base cobre até 13/09/2026");
    // e a semana anterior (07–13/09), coberta, mostra os valores reais
    const ant = (await buscarResumoExecutivo({ inicio: "2026-09-07", fim: "2026-09-13" })).resumo!;
    expect(ant.formas.find((x) => x.id === "credito")!.atual.valor).toBe(100);
    expect(ant.formas.find((x) => x.id === "pix")!.atual.valor).toBe(100);
    expect(ant.formas.find((x) => x.id === "debito")!.atual.valor).toBe(0); // coberta e sem lançamento = zero REAL
  });

  it("janela inválida (não é segunda→domingo, ou semana em andamento) é recusada sem consultar", async () => {
    const quarta = await buscarResumoExecutivo({ inicio: "2026-09-16", fim: "2026-09-22" });
    expect(quarta.resumo).toBeNull();
    expect(quarta.erro).toBeTruthy();
    const futura = await buscarResumoExecutivo({ inicio: "2099-01-05", fim: "2099-01-11" });
    expect(futura.resumo).toBeNull();
    expect(futura.erro).toBeTruthy();
  });

  it("a consulta NÃO grava nada", async () => {
    const hash = async () => (await sql.unsafe("select (select count(*) from faturamento)::int a, (select count(*) from brindes)::int b, (select count(*) from quebra_caixa)::int c, (select count(*) from formas_pagamento)::int d"))[0];
    const antes = await hash();
    await buscarResumoExecutivo(SEMANA);
    expect(await hash()).toEqual(antes);
  });
});
