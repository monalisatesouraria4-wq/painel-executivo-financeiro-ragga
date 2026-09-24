import { describe, expect, it } from "vitest";
import { dataDeDeposito } from "@/lib/rules/deposito";

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
