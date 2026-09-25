import { describe, expect, it } from "vitest";
import { simularGravacao } from "@/lib/import/simularGravacao";
import type { RegistroBase } from "@/lib/import/tipos";

function registro(unidade: string, dataISO: string, valor: number, extras: Record<string, string> = {}): RegistroBase {
  return { unidade: unidade as RegistroBase["unidade"], data: new Date(dataISO), valor, extras, linhaOrigem: 1 };
}

describe("simularGravacao — fechamento_caixa (sem dedup, caixas diferentes)", () => {
  it("dois caixas da mesma filial com o mesmo movimento na mesma data NÃO se fundem (chave inclui 'caixa')", () => {
    const novos = [
      registro("BG 11", "2026-09-21", 0, { caixa: "BG11 - PDV 001", movimento: "1" }),
      registro("BG 11", "2026-09-21", 0, { caixa: "BG11 - PDV 002", movimento: "1" }),
    ];
    // fechamento_caixa é sem-dedup: delete do período + insert — ambos os
    // registros são preservados, mesmo com data+movimento iguais.
    const resultado = simularGravacao("fechamento_caixa", novos, []);
    expect(resultado.estrategia).toBe("delete_periodo_insert");
    expect(resultado.inseridos).toBe(2);
    expect(resultado.totalFinal).toBe(2);
  });
});

describe("simularGravacao — duplicidades legítimas (troco/quebra_caixa/retirada_deposito)", () => {
  it("preserva registros idênticos (mesma unidade/data/valor) sem colapsar", () => {
    const novos = [
      registro("BG 01", "2026-09-21", 400),
      registro("BG 01", "2026-09-21", 400), // duplicidade legítima
    ];
    const resultado = simularGravacao("quebra_caixa", novos, []);
    expect(resultado.inseridos).toBe(2);
    expect(resultado.totalFinal).toBe(2);
  });
});

describe("simularGravacao — reimportação do mesmo período (delete+insert)", () => {
  it("reimportar o mesmo período não duplica: substitui apenas aquele período", () => {
    const estadoAnterior = [registro("BG 01", "2026-09-10", 100), registro("BG 01", "2026-09-11", 200)];
    const reimportacao = [registro("BG 01", "2026-09-10", 999), registro("BG 01", "2026-09-11", 999)];

    const resultado = simularGravacao("troco", reimportacao, estadoAnterior);
    expect(resultado.removidosDoPeriodo).toBe(2);
    expect(resultado.preservadosForaDoPeriodo).toBe(0);
    expect(resultado.inseridos).toBe(2);
    expect(resultado.totalFinal).toBe(2); // não dobrou
  });

  it("preserva períodos anteriores não cobertos pela reimportação", () => {
    const estadoAnterior = [
      registro("BG 01", "2026-08-10", 100), // mês anterior — não deve ser tocado
      registro("BG 01", "2026-09-10", 200),
    ];
    const reimportacaoSetembro = [registro("BG 01", "2026-09-10", 999)];

    const resultado = simularGravacao("retirada_deposito", reimportacaoSetembro, estadoAnterior);
    expect(resultado.removidosDoPeriodo).toBe(1); // só o registro de setembro
    expect(resultado.preservadosForaDoPeriodo).toBe(1); // agosto preservado
    expect(resultado.totalFinal).toBe(2); // agosto + o novo de setembro
  });
});

describe("simularGravacao — upsert por chave (bases com dedup)", () => {
  it("reimportar o mesmo registro atualiza em vez de duplicar", () => {
    const estadoAnterior = [registro("BG 01", "2026-09-10", 100, { motivo: "M1" })];
    const reimportacao = [registro("BG 01", "2026-09-10", 150, { motivo: "M1" })];

    const resultado = simularGravacao("compra_direta", reimportacao, estadoAnterior);
    expect(resultado.atualizados).toBe(1);
    expect(resultado.inseridos).toBe(0);
    expect(resultado.totalFinal).toBe(1);
  });
});
