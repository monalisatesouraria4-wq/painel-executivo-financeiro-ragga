import { describe, expect, it } from "vitest";
import { baseSincronizavel, compararPlanilhaComBanco, emCentavos, planejarSincronizacaoCompraDireta, type LinhaSincronizacao } from "@/lib/import/sincronizacao";

const l = (unidade: string, data: string, extras: string[], valor: number): LinhaSincronizacao => ({ unidade, data, extras, centavos: emCentavos(valor) });

describe("compararPlanilhaComBanco — registros que mudaram de chave", () => {
  it("motivo reclassificado na origem: o registro antigo aparece como 'só no banco', com a chave nova como provável substituta", () => {
    const planilha = [l("BG 07", "2026-10-06", ["CMO"], 27.96), l("BG 01", "2026-10-06", ["FIXAS"], 10)];
    const banco = [l("BG 07", "2026-10-06", ["FIXAS"], 27.96), l("BG 01", "2026-10-06", ["FIXAS"], 10)];
    const r = compararPlanilhaComBanco(planilha, banco);
    expect(r.soNoBanco).toHaveLength(1);
    expect(r.soNoBanco[0]).toMatchObject({ unidade: "BG 07", extras: ["FIXAS"], mesmoValor: true, possivelSubstituta: { extras: ["CMO"], centavos: 2796 } });
    expect(r.emAmbos).toBe(1);
    expect(r.novasNaPlanilha).toBe(1);
  });

  it("chave nova já gravada no banco (importação anterior) continua sendo apontada como substituta", () => {
    const planilha = [l("BG 07", "2026-10-06", ["CMO"], 27.96)];
    const banco = [l("BG 07", "2026-10-06", ["FIXAS"], 27.96), l("BG 07", "2026-10-06", ["CMO"], 27.96)];
    const r = compararPlanilhaComBanco(planilha, banco);
    expect(r.novasNaPlanilha).toBe(0);
    expect(r.soNoBanco).toHaveLength(1);
    expect(r.soNoBanco[0]).toMatchObject({ extras: ["FIXAS"], mesmoValor: true, possivelSubstituta: { extras: ["CMO"] } });
    expect(r.totalEsperadoAposImportacaoCentavos).toBe(2796 + 2796);
  });

  it("sem sincronização o total do banco fica somado em duplicidade: esperado = planilha + órfãos", () => {
    const planilha = [l("BG 07", "2026-10-06", ["CMO"], 27.96)];
    const banco = [l("BG 07", "2026-10-06", ["FIXAS"], 27.96)];
    const r = compararPlanilhaComBanco(planilha, banco);
    expect(r.planilha.centavos).toBe(2796);
    expect(r.soNoBancoCentavos).toBe(2796);
    expect(r.totalEsperadoAposImportacaoCentavos).toBe(5592);
    expect(r.diferencaCentavos).toBe(2796);
  });

  it("data corrigida: registro em outro dia, mesma loja e chave, é órfão sem substituta no mesmo dia", () => {
    const r = compararPlanilhaComBanco([l("BG 02", "2026-10-07", ["FIXAS"], 50)], [l("BG 02", "2026-10-06", ["FIXAS"], 50), l("BG 02", "2026-10-07", ["FIXAS"], 50)]);
    expect(r.soNoBanco).toHaveLength(0); // 06/10 está antes do intervalo do arquivo → fora do escopo
    const r2 = compararPlanilhaComBanco([l("BG 02", "2026-10-05", ["FIXAS"], 1), l("BG 02", "2026-10-07", ["FIXAS"], 50)], [l("BG 02", "2026-10-06", ["FIXAS"], 50)]);
    expect(r2.soNoBanco).toHaveLength(1);
    expect(r2.soNoBanco[0].possivelSubstituta).toBeUndefined();
  });

  it("histórico fora do escopo (outra loja ou fora do intervalo de datas) nunca é listado", () => {
    const planilha = [l("BG 01", "2026-10-01", ["X"], 1), l("BG 01", "2026-10-10", ["X"], 1)];
    const banco = [l("BG 01", "2026-10-01", ["X"], 1), l("BG 01", "2026-09-30", ["Y"], 5), l("BG 01", "2026-10-11", ["Y"], 5), l("BG 09", "2026-10-05", ["Y"], 5)];
    const r = compararPlanilhaComBanco(planilha, banco);
    expect(r.soNoBanco).toHaveLength(0);
    expect(r.escopo).toEqual({ unidades: ["BG 01"], inicio: "2026-10-01", fim: "2026-10-10" });
  });

  it("chaves idênticas com valor diferente não são órfãs (viram atualização)", () => {
    const r = compararPlanilhaComBanco([l("BG 01", "2026-10-01", ["X"], 12)], [l("BG 01", "2026-10-01", ["X"], 10)]);
    expect(r.soNoBanco).toHaveLength(0);
    expect(r.emAmbos).toBe(1);
  });

  it("faturamento (chave só loja+dia): dia ausente na planilha dentro do intervalo é órfão", () => {
    const r = compararPlanilhaComBanco([l("BG 01", "2026-10-01", [], 100), l("BG 01", "2026-10-03", [], 100)], [l("BG 01", "2026-10-02", [], 100)]);
    expect(r.soNoBanco.map((o) => o.data)).toEqual(["2026-10-02"]);
  });

  it("planilha vazia não gera relatório", () => {
    expect(compararPlanilhaComBanco([], [l("BG 01", "2026-10-01", [], 1)]).escopo).toBeNull();
  });

  it("só as bases agregadas por soma são sincronizáveis", () => {
    expect(baseSincronizavel("compraDireta")).toBe(true);
    expect(baseSincronizavel("faturamento")).toBe(true);
    expect(baseSincronizavel("troco")).toBe(false);
  });
});

describe("planejarSincronizacaoCompraDireta — snapshot autoritativo", () => {
  const escopo = { unidades: ["BG 01", "BG 02"], inicio: "2026-10-01", fim: "2026-10-31" };

  it("reimportar a mesma fonte é idempotente: valores não são somados novamente", () => {
    const fonte = [l("BG 01", "2026-10-06", ["OPEX"], 27.96)];
    const primeira = planejarSincronizacaoCompraDireta(fonte, [l("BG 01", "2026-10-06", ["FIXAS"], 27.96)], escopo);
    const segunda = planejarSincronizacaoCompraDireta(fonte, primeira.linhasFinais, escopo);
    expect(primeira.linhasFinais).toEqual([fonte[0]]);
    expect(primeira.removidos).toBe(1);
    expect(segunda.linhasFinais).toEqual(primeira.linhasFinais);
    expect(segunda.inseridos).toBe(0);
    expect(segunda.atualizados).toBe(1);
    expect(segunda.relatorio.planilha.centavos).toBe(2796);
  });

  it("substitui motivo antigo pela chave nova, mesmo que ambas existam no banco", () => {
    const fonte = [l("BG 01", "2026-10-06", ["OPEX"], 27.96)];
    const banco = [fonte[0], l("BG 01", "2026-10-06", ["FIXAS"], 27.96)];
    const plano = planejarSincronizacaoCompraDireta(fonte, banco, escopo);
    expect(plano.linhasFinais.filter((r) => r.unidade === "BG 01" && r.data === "2026-10-06")).toEqual(fonte);
    expect(plano.removidos).toBe(1);
    expect(plano.linhasFinais.reduce((s, r) => s + r.centavos, 0)).toBe(2796);
  });

  it("remove chaves ausentes da fonte, mas preserva registros fora do escopo confirmado", () => {
    const fonte = [l("BG 01", "2026-10-06", ["OPEX"], 10)];
    const banco = [
      l("BG 01", "2026-10-06", ["OPEX"], 10),
      l("BG 02", "2026-10-06", ["REMOVIDO_DA_FONTE"], 5),
      l("BG 01", "2026-09-30", ["HISTORICO"], 7),
      l("BG 03", "2026-10-06", ["OUTRA_UNIDADE"], 8),
    ];
    const plano = planejarSincronizacaoCompraDireta(fonte, banco, escopo);
    expect(plano.removidos).toBe(1);
    expect(plano.linhasFinais).toEqual([banco[2], banco[3], fonte[0]]);
  });

  it("agrega duplicidades idênticas da fonte sem somá-las em reimportações", () => {
    const fonte = [l("BG 01", "2026-10-06", ["OPEX"], 4), l("BG 01", "2026-10-06", ["OPEX"], 6)];
    const plano = planejarSincronizacaoCompraDireta(fonte, [], escopo);
    expect(plano.linhasFinais).toHaveLength(1);
    expect(plano.linhasFinais[0].centavos).toBe(1000);
    expect(plano.inseridos).toBe(1);
  });

  it("recusa fonte vazia e linhas fora do escopo ao planejar exclusões", () => {
    expect(() => planejarSincronizacaoCompraDireta([], [l("BG 01", "2026-10-06", ["FIXAS"], 5)], escopo)).toThrow(/fonte vazia/);
    expect(() => planejarSincronizacaoCompraDireta([l("BG 01", "2026-11-01", ["OPEX"], 5)], [], escopo)).toThrow(/fora do escopo/);
  });

  it("escopo explícito inclui bancos sem linhas da fonte e detecta órfãos nas datas sem movimento", () => {
    const fonte = [l("BG 01", "2026-10-01", ["OPEX"], 10)];
    const banco = [l("BG 02", "2026-10-20", ["FIXAS"], 50)];
    const plano = planejarSincronizacaoCompraDireta(fonte, banco, escopo);
    expect(plano.relatorio.escopo).toEqual(escopo);
    expect(plano.relatorio.soNoBanco).toMatchObject([{ unidade: "BG 02", data: "2026-10-20", extras: ["FIXAS"], centavos: 5000 }]);
    expect(plano.removidos).toBe(1);
  });
});
