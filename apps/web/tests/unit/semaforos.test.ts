import { describe, expect, it } from "vitest";
import {
  classificarSemaforo,
  FAIXAS_CANCELAMENTO,
  FAIXAS_BRINDES,
  FAIXAS_COMPRA_DIRETA,
} from "@/lib/rules/semaforos";

describe("semáforo de cancelamento (salão/delivery)", () => {
  it.each([
    [0.5, "azul"],
    [0.99, "verde"],
    [1.0, "verde"],
    [1.5, "amarelo"],
    [2.0, "amarelo"],
    [2.01, "vermelho"],
  ] as const)("%f%% -> %s", (percentual, cor) => {
    expect(classificarSemaforo(percentual, FAIXAS_CANCELAMENTO)).toBe(cor);
  });
});

describe("semáforo de brindes", () => {
  it.each([
    [0.25, "azul"],
    [0.4, "amarelo"],
    [0.41, "vermelho"],
  ] as const)("%f%% -> %s", (percentual, cor) => {
    expect(classificarSemaforo(percentual, FAIXAS_BRINDES)).toBe(cor);
  });
});

describe("semáforo de compra direta", () => {
  it.each([
    [5.0, "verde"],
    [7.0, "amarelo"],
    [7.01, "vermelho"],
  ] as const)("%f%% -> %s", (percentual, cor) => {
    expect(classificarSemaforo(percentual, FAIXAS_COMPRA_DIRETA)).toBe(cor);
  });
});
