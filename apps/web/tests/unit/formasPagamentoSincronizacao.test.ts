import { describe, expect, it } from "vitest";
import { parseFormasPagamento } from "@/lib/import/parsers/formasPagamento";
import { linhasFonteDeRegistros } from "@/lib/import/bancoSincronizacaoPg";
import { planejarSincronizacaoBase, type LinhaBanco } from "@/lib/import/sincronizacaoBase";
import { agregarEmBuckets } from "@/lib/rules/formasPagamento";

/** VENDAS.xlsx → `formas_pagamento` pela sincronização autoritativa: descrição ORIGINAL guardada, carga idempotente, cada lançamento uma vez. */
const cabecalho = ["Filial", "Caixa", "Data", "Cupom", "Hora", "Itens", "Chave", "CPF/CNPJ", "Nome do cliente", "Desc. pagam.", "Nr. parc", "Vl. pagamento"];
const linha = (filial: string, data: string, forma: string, valor: number) => [filial, "PDV 01", data, "1", "10:00", "1", null, null, null, forma, "1", valor];
const LINHAS = [
  linha("BG 01", "05/10/2026", "CARTAO CREDITO", 100),
  linha("BG 01", "05/10/2026", "TEF - CREDITO", 50),
  linha("BG 01", "05/10/2026", "CARTAO CREDITO", 25), // mesma chave: soma
  linha("BG 01", "05/10/2026", "TEF - PIX", 10),
  linha("BG 02", "06/10/2026", "Cupom de desconto (Pago pelo iFood)", 8),
  linha("BG 02", "06/10/2026", "Pagamento online", 200),
];

const banco = (fonte: ReturnType<typeof linhasFonteDeRegistros>): LinhaBanco[] => fonte.map((l, i) => ({ id: `id-${i}`, unidade: l.unidade, data: l.data, chave: l.chave, centavos: l.centavos }));

describe("Formas de Pagamento — carga a partir do VENDAS.xlsx", () => {
  const registros = parseFormasPagamento(cabecalho, LINHAS).registros;
  const fonte = linhasFonteDeRegistros("formasPagamento", registros);

  it("guarda a descrição ORIGINAL como chave (a classificação só acontece na leitura) e soma lançamentos da mesma chave", () => {
    expect(fonte.map((l) => l.chave[0]).sort()).toEqual(["CARTAO CREDITO", "Cupom de desconto (Pago pelo iFood)", "Pagamento online", "TEF - CREDITO", "TEF - PIX"]);
    expect(fonte.find((l) => l.chave[0] === "CARTAO CREDITO")?.centavos).toBe(12500);
    expect(fonte.reduce((s, l) => s + l.centavos, 0)).toBe(39300); // Σ dos lançamentos = 393,00
  });

  it("primeira carga: tudo novo; a mesma carga repetida (idempotente): nada novo, nada alterado, nada a remover", () => {
    const vazio = planejarSincronizacaoBase({ base: "formasPagamento", fonte, banco: [] });
    expect(vazio.novos).toHaveLength(5);
    const repetida = planejarSincronizacaoBase({ base: "formasPagamento", fonte, banco: banco(fonte) });
    expect(repetida.novos).toHaveLength(0);
    expect(repetida.alterados).toHaveLength(0);
    expect(repetida.removiveis).toHaveLength(0);
    expect(repetida.iguais).toBe(5);
    expect(repetida.hashPlano).not.toBe(vazio.hashPlano);
  });

  it("depois de carregado, as cinco regras de agrupamento consolidam sem duplicar nenhum lançamento", () => {
    const b = agregarEmBuckets(fonte.map((l) => ({ forma: l.chave[0], valor: l.centavos / 100 })));
    expect(b).toMatchObject({ credito: 175, pix: 10, online: 208, outros: 0 });
    expect(Object.values(b).reduce((s, v) => s + v, 0)).toBeCloseTo(393, 2);
  });
});
