import { describe, expect, it } from "vitest";
import { aplicarGravacao } from "@/lib/import/aplicarGravacao";
import type { RegistroBase } from "@/lib/import/tipos";

function registro(unidade: string, dataISO: string, valor: number, extras: Record<string, string> = {}): RegistroBase {
  return { unidade: unidade as RegistroBase["unidade"], data: new Date(dataISO), valor, extras, linhaOrigem: 1 };
}

// aplicarGravacao é a contraparte "real" de simularGravacao (já testada
// em simularGravacao.test.ts) — aqui testamos que o array resultante
// bate com o que simularGravacao já prevê em contagens.
describe("aplicarGravacao — upsert_por_chave (bases com dedup)", () => {
  it("registro novo (chave inédita) é inserido, preservando os existentes", () => {
    const estadoAnterior = [registro("BG 01", "2026-09-10", 100, { motivo: "M1" })];
    const novos = [registro("BG 02", "2026-09-10", 200, { motivo: "M1" })];

    const resultado = aplicarGravacao("compra_direta", novos, estadoAnterior);
    expect(resultado).toHaveLength(2);
    expect(resultado.find((r) => r.unidade === "BG 01")?.valor).toBe(100);
    expect(resultado.find((r) => r.unidade === "BG 02")?.valor).toBe(200);
  });

  it("mesma chave é ATUALIZADA (valor novo substitui o antigo), sem duplicar", () => {
    const estadoAnterior = [registro("BG 01", "2026-09-10", 100, { motivo: "M1" })];
    const novos = [registro("BG 01", "2026-09-10", 999, { motivo: "M1" })];

    const resultado = aplicarGravacao("compra_direta", novos, estadoAnterior);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].valor).toBe(999);
  });

  it("chaves diferentes por caixa não colidem (fechamento_caixa)", () => {
    const estadoAnterior: RegistroBase[] = [];
    const novos = [
      registro("BG 11", "2026-09-21", 0, { caixa: "PDV 001", movimento: "1" }),
      registro("BG 11", "2026-09-21", 0, { caixa: "PDV 002", movimento: "1" }),
    ];
    const resultado = aplicarGravacao("fechamento_caixa", novos, estadoAnterior);
    expect(resultado).toHaveLength(2);
  });

  it("estado anterior fora do arquivo importado é sempre preservado", () => {
    const estadoAnterior = [
      registro("BG 01", "2026-08-01", 50, { motivo: "AGOSTO" }),
      registro("BG 01", "2026-09-10", 100, { motivo: "SETEMBRO" }),
    ];
    const novos = [registro("BG 01", "2026-09-10", 999, { motivo: "SETEMBRO" })];

    const resultado = aplicarGravacao("compra_direta", novos, estadoAnterior);
    expect(resultado).toHaveLength(2);
    expect(resultado.find((r) => r.extras.motivo === "AGOSTO")?.valor).toBe(50);
    expect(resultado.find((r) => r.extras.motivo === "SETEMBRO")?.valor).toBe(999);
  });
});
