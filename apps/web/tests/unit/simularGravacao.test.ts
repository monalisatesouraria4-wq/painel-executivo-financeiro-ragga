import { describe, expect, it } from "vitest";
import { simularGravacao } from "@/lib/import/simularGravacao";
import type { RegistroBase } from "@/lib/import/tipos";

function registro(unidade: string, dataISO: string, valor: number, extras: Record<string, string> = {}): RegistroBase {
  return { unidade: unidade as RegistroBase["unidade"], data: new Date(dataISO), valor, extras, linhaOrigem: 1 };
}

// Etapa 6: fechamento_caixa, troco, retirada_deposito e quebra_caixa
// deixaram de ser "sem dedup" (delete período + insert) — confirmado
// lendo o painel HTML atual, agora usam upsert pela chave composta
// própria de cada base (ver lib/rules/chaves.ts). Os testes abaixo
// substituem os anteriores (que assumiam delete+insert).
describe("simularGravacao — fechamento_caixa: upsert por caixa+movimento (Etapa 6)", () => {
  it("dois caixas diferentes da mesma filial/data/movimento NÃO colidem (chave inclui 'caixa')", () => {
    const novos = [
      registro("BG 11", "2026-09-21", 0, { caixa: "BG11 - PDV 001", movimento: "1" }),
      registro("BG 11", "2026-09-21", 0, { caixa: "BG11 - PDV 002", movimento: "1" }),
    ];
    const resultado = simularGravacao("fechamento_caixa", novos, []);
    expect(resultado.estrategia).toBe("upsert_por_chave");
    expect(resultado.inseridos).toBe(2);
    expect(resultado.totalFinal).toBe(2);
  });

  it("mesma caixa+movimento reimportada é uma ATUALIZAÇÃO (upsert), não um novo registro", () => {
    const estadoAnterior = [registro("BG 11", "2026-09-21", 0, { caixa: "BG11 - PDV 001", movimento: "1" })];
    const reimportacao = [registro("BG 11", "2026-09-21", 0, { caixa: "BG11 - PDV 001", movimento: "1" })];
    const resultado = simularGravacao("fechamento_caixa", reimportacao, estadoAnterior);
    expect(resultado.atualizados).toBe(1);
    expect(resultado.inseridos).toBe(0);
    expect(resultado.totalFinal).toBe(1);
  });
});

describe("simularGravacao — quebra_caixa: upsert por conferente+operador+cpf+motivo (Etapa 6)", () => {
  it("dois lançamentos com a MESMA chave completa colidem (upsert — só o último sobrevive)", () => {
    const extras = { conferente: "MONALISA", operador: "JAIME", cpf: "111", motivo: "BRINDE" };
    const novos = [registro("BG 01", "2026-09-21", 400, extras), registro("BG 01", "2026-09-21", 400, extras)];
    const resultado = simularGravacao("quebra_caixa", novos, []);
    expect(resultado.estrategia).toBe("upsert_por_chave");
    expect(resultado.inseridos).toBe(1); // não 2 — mesma chave, upsert
    expect(resultado.totalFinal).toBe(1);
  });

  it("chaves diferentes (conferente/operador/cpf/motivo distintos) NÃO colidem, mesmo com valor e data iguais", () => {
    const novos = [
      registro("BG 01", "2026-09-21", 400, { conferente: "A", operador: "X", cpf: "111", motivo: "M1" }),
      registro("BG 01", "2026-09-21", 400, { conferente: "B", operador: "Y", cpf: "222", motivo: "M2" }),
    ];
    const resultado = simularGravacao("quebra_caixa", novos, []);
    expect(resultado.inseridos).toBe(2);
    expect(resultado.totalFinal).toBe(2);
  });
});

describe("simularGravacao — troco: upsert por unidade+data+caixa (Etapa 6)", () => {
  it("reimportar o mesmo caixa/data ATUALIZA o registro (upsert), não duplica nem preserva o valor antigo", () => {
    const estadoAnterior = [
      registro("BG 01", "2026-09-10", 100, { caixa: "CAIXA GERENTE" }),
      registro("BG 01", "2026-09-11", 200, { caixa: "CAIXA GERENTE" }),
    ];
    const reimportacao = [
      registro("BG 01", "2026-09-10", 999, { caixa: "CAIXA GERENTE" }),
      registro("BG 01", "2026-09-11", 999, { caixa: "CAIXA GERENTE" }),
    ];

    const resultado = simularGravacao("troco", reimportacao, estadoAnterior);
    expect(resultado.estrategia).toBe("upsert_por_chave");
    expect(resultado.atualizados).toBe(2);
    expect(resultado.inseridos).toBe(0);
    expect(resultado.totalFinal).toBe(2); // não dobrou
  });
});

describe("simularGravacao — retirada_deposito: upsert por chave de 7 campos (Etapa 6)", () => {
  it("preserva registros anteriores cuja chave não aparece na reimportação", () => {
    const extrasSetembro = {
      caixa: "PDV 01", motivo: "DEPOSITO", motivo_descricao: "d1", usuario: "A", usuario_autorizador: "A",
    };
    const estadoAnterior = [
      registro("BG 01", "2026-08-10", 100, { caixa: "PDV 02", motivo: "DEPOSITO", motivo_descricao: "d0", usuario: "B", usuario_autorizador: "B" }),
      registro("BG 01", "2026-09-10", 200, extrasSetembro),
    ];
    const reimportacaoSetembro = [registro("BG 01", "2026-09-10", 999, extrasSetembro)];

    const resultado = simularGravacao("retirada_deposito", reimportacaoSetembro, estadoAnterior);
    expect(resultado.estrategia).toBe("upsert_por_chave");
    expect(resultado.atualizados).toBe(1); // a chave de setembro já existia
    expect(resultado.totalFinal).toBe(2); // agosto preservado + setembro atualizado
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
