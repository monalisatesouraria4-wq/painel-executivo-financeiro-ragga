import { describe, expect, it } from "vitest";
import { identificarBase } from "@/lib/import/identificarBase";
import { BASE_REGISTRY, type BaseId } from "@/lib/services/atualizacaoBases";

const cabecalhoDe = (id: BaseId) => (BASE_REGISTRY.find((b) => b.id === id)?.colunasObrigatorias ?? []).map((c) => c.coluna);
const ARQUIVO: Partial<Record<BaseId, string>> = {
  brindes: "BRINDES.xlsx",
  cancelamentoSalao: "CANCEL SALÃO.xlsx",
  cancelamentoDelivery: "CANCELAMENTOS DELIVERY.xlsx",
  compraDireta: "COMPRA DIRETA.xlsx",
  fechamento: "FECHAMENTO DE CAIXA - ABERTOS_FECHADOS_CONCILIADOS.xlsx.xlsx",
  pdvMaquininha: "PDV X Adquirente - Consolidado.xlsx",
  retiradaDeposito: "Retirada Depósito.xlsx",
  troco: "TROCO SEMANAL.xlsx",
  faturamento: "VENDAS.xlsx",
};

describe("identificarBase — nome do arquivo + colunas obrigatórias oficiais", () => {
  for (const [id, nome] of Object.entries(ARQUIVO) as [BaseId, string][]) {
    it(`${nome} → ${id}`, () => {
      const r = identificarBase({ nomeArquivo: nome, abas: ["Planilha1"], cabecalhoPrimeiraAba: cabecalhoDe(id) });
      expect(r.status).toBe("ok");
      expect(r.bases).toEqual([id]);
    });
  }

  it("planilha por ciclos alimenta Conferência E Quebra de Caixa (qualquer número de versão)", () => {
    const abas = ["MENU", "16.08 a 15.09", "QUEBRA 16-08 A 15-09", "16.09 a 15.10", "QUEBRA 16-09 A 15-10", "RESUMO", "BANCO DE DADOS"];
    for (const nome of ["CONTROLE DE CONFERENCIA E QUEBRAS DE CAIXA (19).xlsx", "CONTROLE DE CONFERENCIA E QUEBRAS DE CAIXA (20).xlsx", "planilha qualquer.xlsx"]) {
      const r = identificarBase({ nomeArquivo: nome, abas, cabecalhoPrimeiraAba: ["MENU"] });
      expect(r).toMatchObject({ status: "ok", bases: ["conferencia", "quebraCaixa"] });
    }
  });

  it("o cabeçalho real do Troco (espaço duplo) é reconhecido", () => {
    const cab = ["LOJA", "DATA", "CAIXA ", "R$ TROCO CONFERIDO PELO GERENTE", "R$ TROCO  INFORMADO PELO COLABORADOR", "DIFERENÇA TROCO ", "OPERADOR ", "PLANO DE AÇÃO "];
    expect(identificarBase({ nomeArquivo: "TROCO SEMANAL (2).xlsx", abas: ["Planilha1"], cabecalhoPrimeiraAba: cab })).toMatchObject({ status: "ok", bases: ["troco"] });
  });

  it("o nome aponta uma base mas faltam colunas → RECUSADO (nunca é importado como outra base)", () => {
    const r = identificarBase({ nomeArquivo: "TROCO SEMANAL.xlsx", abas: ["Planilha1"], cabecalhoPrimeiraAba: cabecalhoDe("brindes") });
    expect(r.status).toBe("recusado");
    expect(r.bases).toEqual([]);
    expect(r.motivo).toMatch(/Troco/);
  });

  it("PDV com a coluna Tipo_Pagamento no lugar de 'Forma de Pag.' continua aceito pela validação oficial", () => {
    const cab = ["Loja", "Data", "Tipo_Pagamento", "Venda (PDV)", "Total Maq.", "Diferença"];
    expect(identificarBase({ nomeArquivo: "PDV X Adquirente - Consolidado.xlsx", abas: ["Planilha1"], cabecalhoPrimeiraAba: cab })).toMatchObject({ status: "ok", bases: ["pdvMaquininha"] });
  });

  it("sem dica no nome: uma única base compatível é aceita; nenhuma → desconhecido; várias → ambíguo", () => {
    const salao = ["Filial", "Produto", "Comanda", "Qtde.", "Valor total", "Data/hora estorno", "Atendente lançamento", "Autorizador", "Motivo", "Justificativa"];
    // o cabeçalho do Salão serve a várias listas simples: SEM o nome do arquivo é ambíguo (nunca "adivinha")
    expect(identificarBase({ nomeArquivo: "arquivo.xlsx", abas: ["Planilha"], cabecalhoPrimeiraAba: salao }).status).toBe("ambiguo");
    const troco = ["LOJA", "DATA", "CAIXA ", "R$ TROCO CONFERIDO PELO GERENTE", "R$ TROCO  INFORMADO PELO COLABORADOR"];
    expect(identificarBase({ nomeArquivo: "arquivo.xlsx", abas: ["Planilha"], cabecalhoPrimeiraAba: troco })).toMatchObject({ status: "ok", bases: ["troco"] });
    expect(identificarBase({ nomeArquivo: "arquivo.xlsx", abas: ["Planilha"], cabecalhoPrimeiraAba: ["A", "B", "C"] }).status).toBe("desconhecido");
    const uniao = [...new Set([...cabecalhoDe("cancelamentoSalao"), ...cabecalhoDe("cancelamentoDelivery")])];
    const amb = identificarBase({ nomeArquivo: "arquivo.xlsx", abas: ["Planilha"], cabecalhoPrimeiraAba: uniao });
    expect(amb.status).toBe("ambiguo");
    expect(amb.bases).toEqual(expect.arrayContaining(["cancelamentoSalao", "cancelamentoDelivery"]));
  });
});
