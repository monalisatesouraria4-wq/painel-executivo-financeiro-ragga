import { describe, expect, it } from "vitest";
import { semanaRealDoPeriodo } from "@/lib/rules/datas";

describe("regra única de datas", () => {
  it("lib/rules/datas.ts não exporta funções de deslocamento (D-1/D-2)", async () => {
    const m = await import("@/lib/rules/datas");
    expect(Object.keys(m)).toEqual(["semanaRealDoPeriodo"]);
  });
});

describe("semanaRealDoPeriodo", () => {
  it("retorna segunda a domingo da semana corrente", () => {
    const { inicio, fim } = semanaRealDoPeriodo(new Date("2026-09-24")); // quinta-feira
    expect(inicio.toISOString().slice(0, 10)).toBe("2026-09-21"); // segunda
    expect(fim.toISOString().slice(0, 10)).toBe("2026-09-27"); // domingo
  });

  it("funciona quando a data de referência é domingo", () => {
    const { inicio, fim } = semanaRealDoPeriodo(new Date("2026-09-27"));
    expect(inicio.toISOString().slice(0, 10)).toBe("2026-09-21");
    expect(fim.toISOString().slice(0, 10)).toBe("2026-09-27");
  });
});
