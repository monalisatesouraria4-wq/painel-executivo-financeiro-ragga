import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { processarArquivoBase } from "@/lib/services/atualizacaoBases";

/**
 * Importação de Quebra de Caixa PELA INTERFACE (Atualização de Bases): `processarArquivoBase` lê o arquivo no navegador e entrega ao
 * Server Action `persistirBaseNoBanco`. Garante que o lote já vai numerado por OCORRÊNCIA (a chave única nova), com as linhas repetidas
 * preservadas individualmente, a data real de cada lançamento e a fonte da aba — e que nada é gravado pelo caminho antigo.
 */
const persistir = vi.hoisted(() => vi.fn(async () => ({ tipoBase: "quebra_caixa", inseridos: 0, atualizados: 0, totalFinal: 0 })));
vi.mock("@/lib/actions/persistirBase", () => ({ persistirBaseNoBanco: persistir }));
vi.mock("@/lib/actions/persistirCancelamentoSalaoDetalhes", () => ({ persistirDetalhesCancelamentoSalao: vi.fn(async () => null) }));

async function planilha(): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("QUEBRA 16-09 A 15-10");
  ws.addRow(["QUEBRA DE CAIXA"]); ws.addRow([""]); ws.addRow([""]);
  ws.addRow(["MÊS", "DATA", "LOJA", "CONFERENTE", "QUEBRA", "OPERADOR", "CPF", "MOTIVO"]);
  const L = (data: string, loja: string, v: number, op: string) => ws.addRow(["X", new Date(`${data}T00:00:00.000Z`), loja, "MONALISA", v, op, "111", "ERRO DE DESPACHO"]);
  L("2026-09-16", "BG 01", 10, "A"); L("2026-09-20", "BG 02", 11, "B"); L("2026-10-01", "BG 03", 12, "C");
  for (let i = 0; i < 5; i++) L("2026-10-04", "BG 07", 6.5, "OPERADORA UM"); // 5 linhas idênticas legítimas
  L("2026-09-27", "BG 07", 7, "OPERADOR DOIS"); L("2026-09-27", "BG 07", 7, "OPERADOR DOIS");
  L("2026-10-16", "BG 04", 6.5, "OPERADORA SETE"); // posterior ao ciclo da aba: vale pela data real
  return new File([(await wb.xlsx.writeBuffer()) as BlobPart], "CONTROLE (99).xlsx");
}

describe("Importação de Quebra pela interface", () => {
  beforeEach(() => persistir.mockClear());

  it("entrega ao servidor o lote numerado por ocorrência, sem perder nenhuma linha, com a fonte da aba", async () => {
    const r = await processarArquivoBase("quebraCaixa", await planilha(), [], new Date("2026-10-20T00:00:00.000Z"));
    expect(r.status).toBe("sucesso");
    expect(persistir).toHaveBeenCalledTimes(1);
    const [id, registros, , fonte] = persistir.mock.calls[0] as unknown as [string, Array<{ unidade: string; data: Date; valor: number; extras: Record<string, string> }>, unknown, { nomeAba: string; periodoInicio: Date; periodoFim: Date }];
    expect(id).toBe("quebraCaixa");
    expect(registros).toHaveLength(11); // todas as linhas válidas (3 + 5 + 2 + 1)
    const ana = registros.filter((x) => x.extras.operador === "OPERADORA UM");
    expect(ana.map((x) => x.extras.ocorrencia).sort()).toEqual(["1", "2", "3", "4", "5"]);
    expect(registros.filter((x) => x.extras.operador === "OPERADOR DOIS").map((x) => x.extras.ocorrencia).sort()).toEqual(["1", "2"]);
    // nenhuma chave oficial (natural + ocorrência) repetida: a chave única nova nunca colide
    const chaves = registros.map((x) => [x.unidade, x.data.toISOString().slice(0, 10), x.extras.conferente, x.extras.operador, x.extras.cpf, x.extras.motivo, x.extras.ocorrencia].join("|"));
    expect(new Set(chaves).size).toBe(registros.length);
    // data real preservada (inclusive a posterior ao ciclo) e total = soma das linhas
    expect(registros.some((x) => x.data.toISOString().slice(0, 10) === "2026-10-16")).toBe(true);
    expect(Math.round(registros.reduce((a, x) => a + x.valor, 0) * 100) / 100).toBe(10 + 11 + 12 + 5 * 6.5 + 14 + 6.5);
    expect(fonte.nomeAba).toBe("QUEBRA 16-09 A 15-10");
    expect(fonte.periodoInicio.toISOString().slice(0, 10)).toBe("2026-09-16");
    expect(fonte.periodoFim.toISOString().slice(0, 10)).toBe("2026-10-15");
  });
});
