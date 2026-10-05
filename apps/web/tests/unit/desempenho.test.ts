import { describe, expect, it } from "vitest";
import {
  diasNoPeriodo,
  metaDoSemaforo,
  periodoEquivalenteMesAnterior,
  projecaoDeFechamento,
} from "@/lib/rules/desempenho";
import { FAIXAS_BRINDES, FAIXAS_CANCELAMENTO, FAIXAS_COMPRA_DIRETA } from "@/lib/rules/semaforos";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("metas vindas do semáforo", () => {
  it("usa o teto da última faixa azul/verde", () => {
    expect(metaDoSemaforo(FAIXAS_BRINDES)).toBe(0.25);
    expect(metaDoSemaforo(FAIXAS_CANCELAMENTO)).toBe(1);
    expect(metaDoSemaforo(FAIXAS_COMPRA_DIRETA)).toBe(5);
  });
});

describe("períodos", () => {
  it("conta dias inclusive", () => {
    expect(diasNoPeriodo(d("2026-10-01"), d("2026-10-30"))).toBe(30);
    expect(diasNoPeriodo(d("2026-10-01"), d("2026-10-01"))).toBe(1);
  });
  it("mês em andamento compara os mesmos dias do mês anterior", () => {
    const p = periodoEquivalenteMesAnterior(d("2026-10-01"), d("2026-10-15"));
    expect(p.inicio).toEqual(d("2026-09-01"));
    expect(p.fim).toEqual(d("2026-09-15"));
  });
  it("limita ao último dia do mês anterior (31/03 → 28/02) e vira o ano", () => {
    expect(periodoEquivalenteMesAnterior(d("2026-03-01"), d("2026-03-31")).fim).toEqual(d("2026-02-28"));
    expect(periodoEquivalenteMesAnterior(d("2026-01-01"), d("2026-01-10")).inicio).toEqual(d("2025-12-01"));
  });
  it("projeta o fechamento só no mês em andamento", () => {
    expect(projecaoDeFechamento(d("2026-10-01"), d("2026-10-10"), 1000)).toBeCloseTo(3100);
    expect(projecaoDeFechamento(d("2026-10-01"), d("2026-10-31"), 1000)).toBeNull();
    expect(projecaoDeFechamento(d("2026-10-05"), d("2026-10-10"), 1000)).toBeNull();
  });
});
