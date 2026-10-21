import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASES_SNAPSHOT } from "@/lib/import/basesSnapshot";
import { compactarLote, expandirLote, LIMITE_REGISTROS_LOTE } from "@/lib/import/loteCompacto";
import { CONFIG_SINCRONIZACAO, planejarSincronizacaoBase } from "@/lib/import/sincronizacaoBase";
import { linhasFonteDeRegistros } from "@/lib/import/bancoSincronizacaoPg";
import type { RegistroBase } from "@/lib/import/tipos";

const reg = (base: (typeof BASES_SNAPSHOT)[number], unidade: string, data: string, valor: number, chave: string[]): RegistroBase => {
  const extras: Record<string, string> = {};
  CONFIG_SINCRONIZACAO[base].camposChave.forEach((c, i) => { extras[c] = chave[i] ?? ""; });
  return { unidade: unidade as RegistroBase["unidade"], data: new Date(`${data}T00:00:00.000Z`), valor, extras, linhaOrigem: 7 };
};

describe("lote compacto — ida e volta sem perda", () => {
  it.each(BASES_SNAPSHOT)("%s: compactar → expandir preserva unidade, data, centavos e a chave", (base) => {
    const chave = CONFIG_SINCRONIZACAO[base].camposChave.map((_, i) => `valor ${i} áçã | "x"`);
    const original = [reg(base, "BG 01", "2026-10-01", 10.5, chave), reg(base, "IS 01", "2026-02-28", 0.1 + 0.2, chave), reg(base, "BG 02", "2024-02-29", 1234567.89, chave), reg(base, "BG 03", "2026-12-31", 0, chave)];
    const { registros } = expandirLote(base, JSON.parse(JSON.stringify(compactarLote(base, original))));
    expect(registros).toHaveLength(original.length);
    registros.forEach((r, i) => {
      expect(r.unidade).toBe(original[i].unidade);
      expect(r.data.toISOString()).toBe(original[i].data.toISOString());
      expect(Math.round(r.valor * 100)).toBe(Math.round(original[i].valor * 100));
      expect(r.extras).toEqual(original[i].extras);
    });
  });

  it("o plano calculado a partir do lote expandido é IDÊNTICO ao do lote original (mesmo hash do comando)", () => {
    const base = "brindes" as const;
    const original = [reg(base, "BG 01", "2026-10-01", 10, ["A", "x"]), reg(base, "BG 01", "2026-10-02", 7.35, ["B", ""]), reg(base, "BG 02", "2026-10-02", 0.07, ["A", ""])];
    const direto = planejarSincronizacaoBase({ base, fonte: linhasFonteDeRegistros(base, original), banco: [] });
    const viaLote = planejarSincronizacaoBase({ base, fonte: linhasFonteDeRegistros(base, expandirLote(base, compactarLote(base, original)).registros), banco: [] });
    expect(viaLote.hashPlano).toBe(direto.hashPlano);
  });

  it("é bem menor que o formato anterior (e Brindes completo cabe em 1 MB com folga)", () => {
    const base = "brindes" as const;
    const original = Array.from({ length: 6589 }, (_, i) => reg(base, "BG 07", `2026-0${6 + (i % 4)}-${String(1 + (i % 28)).padStart(2, "0")}`, i / 7, ["BRINDE PRESENTE", i % 5 === 0 ? "DESCONTO VENCIMENTO" : "ERRO ENTREGADOR"]));
    const antigo = JSON.stringify(original).length;
    const novo = JSON.stringify(compactarLote(base, original)).length;
    expect(novo).toBeLessThan(antigo / 2);
    expect(novo).toBeLessThan(700 * 1024);
  });
});

describe("expandirLote — validação no servidor", () => {
  const ok = ["BG 01", "2026-10-01", 100, "OPEX"];
  it("aceita um lote válido", () => expect(expandirLote("compraDireta", [ok]).registros[0].valor).toBe(1));
  it.each([
    ["base sem sincronização", "troco", [ok]],
    ["base não é texto", 5, [ok]],
    ["lote vazio", "compraDireta", []],
    ["lote não é lista", "compraDireta", "x"],
    ["unidade desconhecida", "compraDireta", [["XX 99", "2026-10-01", 100, "OPEX"]]],
    ["data com hora", "compraDireta", [["BG 01", "2026-10-01T10:00:00Z", 100, "OPEX"]]],
    ["data inexistente", "compraDireta", [["BG 01", "2026-02-30", 100, "OPEX"]]],
    ["centavos fracionados", "compraDireta", [["BG 01", "2026-10-01", 10.5, "OPEX"]]],
    ["centavos NaN", "compraDireta", [["BG 01", "2026-10-01", Number.NaN, "OPEX"]]],
    ["centavos em texto", "compraDireta", [["BG 01", "2026-10-01", "100", "OPEX"]]],
    ["falta campo de chave", "compraDireta", [["BG 01", "2026-10-01", 100]]],
    ["campo de chave a mais", "compraDireta", [["BG 01", "2026-10-01", 100, "OPEX", "X"]]],
    ["campo de chave não é texto", "compraDireta", [["BG 01", "2026-10-01", 100, 7]]],
    ["formato antigo (objeto)", "compraDireta", [{ unidade: "BG 01", data: "2026-10-01", valor: 1, extras: { motivo: "X" } }]],
    ["Brindes exige 2 campos de chave", "brindes", [["BG 01", "2026-10-01", 100, "A"]]],
    ["Faturamento não tem campo de chave", "faturamento", [["BG 01", "2026-10-01", 100, "A"]]],
  ])("recusa: %s", (_n, base, lote) => {
    expect(() => expandirLote(base, lote)).toThrow(/inválid|sem sincronização/);
  });
  it("recusa lote acima do limite", () => {
    expect(() => expandirLote("faturamento", new Array(LIMITE_REGISTROS_LOTE + 1).fill(["BG 01", "2026-10-01", 1]))).toThrow(/Lote inválido/);
  });
});

describe("configuração do limite de corpo das Server Actions", () => {
  it("next.config.ts define bodySizeLimit de 4 MB (abaixo dos 4,5 MB das Vercel Functions)", () => {
    const cfg = readFileSync("next.config.ts", "utf-8");
    expect(cfg).toMatch(/bodySizeLimit:\s*"4mb"/);
  });
});
