import { describe, expect, it } from "vitest";
import { ehMesCalendarioCompleto, mesAnteriorCompleto, periodoComparacaoPadrao } from "@/lib/rules/mesAnterior";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe("mês anterior (comparativo mensal)", () => {
  it("01/09–30/09 → 01/08–31/08", () => {
    const r = mesAnteriorCompleto(d("2026-09-01"), d("2026-09-30"));
    expect(r && [iso(r.inicio), iso(r.fim)]).toEqual(["2026-08-01", "2026-08-31"]);
  });
  it("virada de ano e fevereiro", () => {
    const jan = mesAnteriorCompleto(d("2026-01-01"), d("2026-01-31"));
    expect(jan && [iso(jan.inicio), iso(jan.fim)]).toEqual(["2025-12-01", "2025-12-31"]);
    const mar = mesAnteriorCompleto(d("2026-03-01"), d("2026-03-31"));
    expect(mar && [iso(mar.inicio), iso(mar.fim)]).toEqual(["2026-02-01", "2026-02-28"]);
  });
  it("período que não é mês completo não tem mês anterior", () => {
    expect(mesAnteriorCompleto(d("2026-09-01"), d("2026-09-15"))).toBeNull();
    expect(mesAnteriorCompleto(d("2026-09-02"), d("2026-09-30"))).toBeNull();
    expect(mesAnteriorCompleto(d("2026-09-01"), d("2026-10-31"))).toBeNull();
    expect(mesAnteriorCompleto(d("2026-10-02"), d("2026-10-02"))).toBeNull();
    expect(ehMesCalendarioCompleto(d("2026-09-01"), d("2026-09-30"))).toBe(true);
  });
});

describe("período de comparação padrão (navegação por ?inicio=&fim=)", () => {
  it("mês completo → mês anterior completo", () => {
    const r = periodoComparacaoPadrao(d("2026-09-01"), d("2026-09-30"));
    expect([iso(r.inicio), iso(r.fim)]).toEqual(["2026-08-01", "2026-08-31"]);
  });
  it("outro período → período imediatamente anterior de mesma duração", () => {
    const r = periodoComparacaoPadrao(d("2026-10-02"), d("2026-10-03"));
    expect([iso(r.inicio), iso(r.fim)]).toEqual(["2026-09-30", "2026-10-01"]);
    const um = periodoComparacaoPadrao(d("2026-10-10"), d("2026-10-10"));
    expect([iso(um.inicio), iso(um.fim)]).toEqual(["2026-10-09", "2026-10-09"]);
  });
});
