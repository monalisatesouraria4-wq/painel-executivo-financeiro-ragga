import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { processarArquivoBase } from "@/lib/services/atualizacaoBases";

/**
 * Bases com SINCRONIZAÇÃO AUTORITATIVA: `processarArquivoBase` NUNCA grava (devolve só a prévia para a tela chamar a
 * simulação no servidor). As demais bases mantêm o fluxo anterior. Dados 100% fictícios; a persistência é um espião.
 */
const persistir = vi.hoisted(() => vi.fn(async () => null));
const persistirDetalhes = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@/lib/actions/persistirBase", () => ({ persistirBaseNoBanco: persistir }));
vi.mock("@/lib/actions/persistirCancelamentoSalaoDetalhes", () => ({ persistirDetalhesCancelamentoSalao: persistirDetalhes }));

async function xlsx(linhas: unknown[][], nome = "arquivo.xlsx"): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Planilha");
  linhas.forEach((l) => ws.addRow(l));
  return new File([(await wb.xlsx.writeBuffer()) as BlobPart], nome);
}

const ARQUIVOS: Record<string, { id: Parameters<typeof processarArquivoBase>[0]; linhas: unknown[][] }> = {
  faturamento: { id: "faturamento", linhas: [["Filial", "Data", "Desc. pagam.", "Vl. pagamento"], ["BG 01", "01/10/2026", "DINHEIRO", 100]] },
  brindes: { id: "brindes", linhas: [["LOJA", "DATA", "VALOR", "MOTIVO", "MOTIVO 02"], ["BG 01", "01/10/2026", 10, "BRINDE PRESENTE", "DESCONTO"]] },
  cancelamentoSalao: {
    id: "cancelamentoSalao",
    linhas: [["FILIAL", "DATA/HORA ESTORNO", "VALOR TOTAL", "MOTIVO"], ["BG 01", "01/10/2026 20:15", 30, "ERRO"]],
  },
  cancelamentoDelivery: { id: "cancelamentoDelivery", linhas: [["FILIAL", "DATA/HORA", "TOTAL DO PEDIDO", "MOTIVO"], ["BG 01", "01/10/2026 20:15", 30, "ERRO"]] },
  compraDireta: { id: "compraDireta", linhas: [["FILIAL", "DATA", "VALOR", "MOTIVO"], ["BG 01", "01/10/2026", 10, "OPEX"]] },
  retiradaDeposito: {
    id: "retiradaDeposito",
    linhas: [["Filial", "Caixa", "Data", "Valor", "Motivo", "Motivo/Descrição", "Usuário", "Usuário autorizador"], ["BG 01", "CX", "01/10/2026", 10, "DEPÓSITO", "", "u", "a"]],
  },
};

describe("processarArquivoBase — bases com sincronização autoritativa devolvem só a prévia", () => {
  beforeEach(() => { persistir.mockClear(); persistirDetalhes.mockClear(); });

  it.each(Object.keys(ARQUIVOS))("%s: não persiste, devolve o lote e o SHA-256 do arquivo", async (chave) => {
    const { id, linhas } = ARQUIVOS[chave];
    const r = await processarArquivoBase(id, await xlsx(linhas), [], new Date("2026-10-02"));
    expect(r.status).toBe("sucesso");
    if (r.status !== "sucesso") return;
    expect(r.persistidoNoBanco).toBe(false);
    expect(r.registrosSincronizacao?.length).toBeGreaterThan(0);
    expect(r.arquivoSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(persistir).not.toHaveBeenCalled(); // nenhum upsert antigo
    expect(persistirDetalhes).not.toHaveBeenCalled(); // nem detalhes do Cancelamento Salão: só depois da confirmação
  });

  it("Cancelamento Salão: os detalhes individuais vêm para gravar DEPOIS da sincronização confirmada", async () => {
    const { id, linhas } = ARQUIVOS.cancelamentoSalao;
    const r = await processarArquivoBase(id, await xlsx(linhas), [], new Date("2026-10-02"));
    expect(r.status === "sucesso" && (r.detalhesParaGravar?.length ?? 0) > 0).toBe(true);
  });

  it("o mesmo arquivo ⇒ mesmo SHA-256; conteúdo diferente ⇒ SHA-256 diferente", async () => {
    const { id, linhas } = ARQUIVOS.compraDireta;
    const mesmoArquivo = await xlsx(linhas); // o ExcelJS grava a data de criação no .xlsx: arquivos gerados em instantes diferentes têm bytes diferentes
    const a = await processarArquivoBase(id, mesmoArquivo, [], new Date());
    const b = await processarArquivoBase(id, mesmoArquivo, [], new Date());
    const c = await processarArquivoBase(id, await xlsx([linhas[0], ["BG 01", "01/10/2026", 11, "OPEX"]]), [], new Date());
    const sha = (x: typeof a) => (x.status === "sucesso" ? x.arquivoSha256 : undefined);
    expect(sha(a)).toBe(sha(b));
    expect(sha(c)).not.toBe(sha(a));
  });

  it("Retirada Depósito: linhas de outros motivos são ruído conhecido (fora do escopo) e NÃO bloqueiam", async () => {
    const { id, linhas } = ARQUIVOS.retiradaDeposito;
    const r = await processarArquivoBase(id, await xlsx([...linhas, ["BG 01", "CX", "01/10/2026", 99, "SUPRIMENTO", "", "u", "a"]]), [], new Date());
    expect(r.status).toBe("sucesso");
    if (r.status === "sucesso") expect(r.rejeitados).toBe(1);
  });

  it("rejeição com dado real (data inválida, unidade desconhecida com conteúdo) bloqueia a prévia", async () => {
    const r = await processarArquivoBase("faturamento", await xlsx([["Filial", "Data", "Desc. pagam.", "Vl. pagamento"], ["BG 01", "01/10/2026", "DINHEIRO", 100], ["BG 01", "99/99/9999", "DINHEIRO", 5]]), [], new Date());
    expect(r.status).toBe("erro");
    if (r.status === "erro") expect(r.mensagem).toMatch(/Sincronização autoritativa bloqueada/);
    const r2 = await processarArquivoBase("compraDireta", await xlsx([["FILIAL", "DATA", "VALOR", "MOTIVO"], ["BG 01", "01/10/2026", 1, "OPEX"], ["LOJA INVÁLIDA", "01/10/2026", 2, "OPEX"]]), [], new Date());
    expect(r2.status).toBe("erro");
  });

  it("as demais bases (ex.: PDV × Maquininha) mantêm o fluxo anterior de persistência", async () => {
    const r = await processarArquivoBase("pdvMaquininha", await xlsx([["Loja", "Data", "Forma de Pag.", "Venda (PDV)", "Total Maq.", "Diferença"], ["BG 01", "10/09/2026", "CREDITO", 100, 100, 0]]), [], new Date());
    expect(r.status).toBe("sucesso");
    expect(persistir).toHaveBeenCalledTimes(1);
  });
});
