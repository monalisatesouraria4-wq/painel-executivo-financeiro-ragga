import { describe, expect, it } from "vitest";
import { dataDeDeposito, inicioCicloDeposito } from "@/lib/rules/deposito";

describe("dataDeDeposito", () => {
  it("segunda -> depósito na sexta da mesma semana", () => {
    expect(dataDeDeposito(new Date("2026-09-21")).toISOString().slice(0, 10)).toBe("2026-09-25");
  });
  it("quinta -> depósito na sexta da mesma semana", () => {
    expect(dataDeDeposito(new Date("2026-09-24")).toISOString().slice(0, 10)).toBe("2026-09-25");
  });
  it("sexta -> depósito na segunda seguinte", () => {
    expect(dataDeDeposito(new Date("2026-09-25")).toISOString().slice(0, 10)).toBe("2026-09-28");
  });
  it("sábado -> depósito na segunda seguinte", () => {
    expect(dataDeDeposito(new Date("2026-09-26")).toISOString().slice(0, 10)).toBe("2026-09-28");
  });
  it("domingo -> depósito na segunda seguinte", () => {
    expect(dataDeDeposito(new Date("2026-09-27")).toISOString().slice(0, 10)).toBe("2026-09-28");
  });
});

// Porta fiel de getCicloInfo (legado) — mesma regra semanal de
// dataDeDeposito, só devolvendo o início do ciclo em vez do dia do
// depósito. 2026-09-21 é segunda; 2026-09-25 é sexta.
describe("inicioCicloDeposito", () => {
  it("segunda -> início é a própria segunda", () => {
    expect(inicioCicloDeposito(new Date("2026-09-21")).toISOString().slice(0, 10)).toBe("2026-09-21");
  });
  it("quinta -> início é a segunda da mesma semana", () => {
    expect(inicioCicloDeposito(new Date("2026-09-24")).toISOString().slice(0, 10)).toBe("2026-09-21");
  });
  it("sexta -> início é a própria sexta", () => {
    expect(inicioCicloDeposito(new Date("2026-09-25")).toISOString().slice(0, 10)).toBe("2026-09-25");
  });
  it("sábado -> início é a sexta anterior", () => {
    expect(inicioCicloDeposito(new Date("2026-09-26")).toISOString().slice(0, 10)).toBe("2026-09-25");
  });
  it("domingo -> início é a sexta anterior", () => {
    expect(inicioCicloDeposito(new Date("2026-09-27")).toISOString().slice(0, 10)).toBe("2026-09-25");
  });
});
