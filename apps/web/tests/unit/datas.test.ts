import { describe, expect, it } from "vitest";
import { dataDMenos1, dataDMenos2, semanaRealDoPeriodo } from "@/lib/rules/datas";

describe("dataDMenos1", () => {
  it("calcula o dia anterior", () => {
    expect(dataDMenos1(new Date("2026-09-24")).toISOString().slice(0, 10)).toBe("2026-09-23");
  });

  it("respeita virada de mês", () => {
    expect(dataDMenos1(new Date("2026-10-01")).toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("respeita virada de ano", () => {
    expect(dataDMenos1(new Date("2027-01-01")).toISOString().slice(0, 10)).toBe("2026-12-31");
  });
});

describe("dataDMenos2", () => {
  it("calcula dois dias antes, cruzando virada de mês", () => {
    expect(dataDMenos2(new Date("2026-03-01")).toISOString().slice(0, 10)).toBe("2026-02-27");
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
