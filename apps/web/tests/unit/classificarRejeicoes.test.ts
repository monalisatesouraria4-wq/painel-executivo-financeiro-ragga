import { describe, expect, it } from "vitest";
import { assinaturaRejeicao, classificarRejeicao, resumirClasses } from "@/lib/import/classificarRejeicoes";

describe("classificarRejeicao — ruído conhecido × rejeição que exige decisão", () => {
  it("linhas em branco formatadas (todos os valores vazios) são ignoráveis", () => {
    expect(classificarRejeicao("quebraCaixa", { linhaOrigem: 98, motivo: 'Unidade não reconhecida: ""', valoresBrutos: {} })).toBe("em-branco");
    expect(classificarRejeicao("compraDireta", { linhaOrigem: 5, motivo: 'Unidade não reconhecida: ""', valoresBrutos: { A: null, B: "" } })).toBe("em-branco");
    expect(classificarRejeicao("compraDireta", { linhaOrigem: 5, motivo: "x" })).toBe("em-branco");
  });

  it("Retirada Depósito: motivo diferente de DEPOSITO é regra de escopo, não erro", () => {
    const r = { linhaOrigem: 2, motivo: 'Motivo = "SUPRIMENTO" — fora do escopo de Retirada Depósito (só "DEPOSITO" entra)', valoresBrutos: { unidade: "BG 01", motivo: "SUPRIMENTO" } };
    expect(classificarRejeicao("retiradaDeposito", r)).toBe("fora-de-escopo");
    expect(classificarRejeicao("brindes", r)).toBe("atencao"); // só vale para a Retirada Depósito
  });

  it("Conferência/Quebra: totais e legendas impressos na aba são estruturais", () => {
    const total = { linhaOrigem: 24, motivo: 'Unidade não reconhecida: "TOTAL DE CAIXAS"', valoresBrutos: { Filial: "TOTAL DE CAIXAS", "Qtd. caixas": 64 } };
    expect(classificarRejeicao("conferencia", total)).toBe("estrutural");
    const nota = { linhaOrigem: 26, motivo: 'Unidade não reconhecida: "Digite a quantidade conferida no dia  •  0 = conferido sem caixas"', valoresBrutos: { Filial: "x" } };
    expect(classificarRejeicao("conferencia", nota)).toBe("estrutural");
  });

  it("dado real rejeitado (data inválida, valor inválido, unidade desconhecida com conteúdo) exige atenção", () => {
    const data = { linhaOrigem: 113, motivo: 'Data inválida: "06/10/026"', valoresBrutos: { LOJA: "BG 02", DATA: "06/10/026", QUEBRA: 12.35 } };
    expect(classificarRejeicao("quebraCaixa", data)).toBe("atencao");
    expect(classificarRejeicao("brindes", { linhaOrigem: 9, motivo: 'Unidade não reconhecida: "XX"', valoresBrutos: { LOJA: "XX", VALOR: 10 } })).toBe("atencao");
  });

  it("uma rejeição já aceita (assinatura exata) deixa de pedir decisão; qualquer mudança nos valores volta a pedir", () => {
    const r = { linhaOrigem: 178, motivo: "Caixa vazio", valoresBrutos: { LOJA: "ROBS", DATA: "2026-04-22T00:00:00.000Z" } };
    const aceitas = [assinaturaRejeicao("troco", r)];
    expect(classificarRejeicao("troco", r, aceitas)).toBe("aceita");
    expect(classificarRejeicao("troco", { ...r, valoresBrutos: { LOJA: "ROBS", DATA: "2026-04-23T00:00:00.000Z" } }, aceitas)).toBe("atencao");
    expect(classificarRejeicao("fechamento", r, aceitas)).toBe("atencao"); // a aceitação vale para a base
  });

  it("resumirClasses agrupa corretamente", () => {
    const r = resumirClasses("retiradaDeposito", [
      { linhaOrigem: 1, motivo: 'Motivo = "X" — fora do escopo de Retirada Depósito (só "DEPOSITO" entra)', valoresBrutos: { a: 1 } },
      { linhaOrigem: 2, motivo: "Data inválida", valoresBrutos: { a: 1 } },
      { linhaOrigem: 3, motivo: "x", valoresBrutos: {} },
    ]);
    expect([r["fora-de-escopo"].length, r.atencao.length, r["em-branco"].length]).toEqual([1, 1, 1]);
  });
});
