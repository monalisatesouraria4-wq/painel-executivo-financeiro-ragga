import { describe, expect, it } from "vitest";
import { buildResumo, buildWhatsappText, type WhatsappReportData } from "@/lib/services/fechamentoWhatsapp";

function relatorio(overrides: Partial<WhatsappReportData> = {}): WhatsappReportData {
  return {
    dateStr: "27/09/2026",
    faturamentoTotal: 10000,
    formaBuckets: {
      credito: 3000,
      debito: 2000,
      pix: 4000,
      voucher: 500,
      vendaAPrazo: 300,
      online: 200,
      dinheiro: 0,
      outros: 0,
    },
    brindeTotal: 0,
    brindeMotivoMap: {},
    cancSalaoTotal: 0,
    cancSalaoMotivoMap: {},
    cancDeliveryTotal: 0,
    cancDeliveryMotivoMap: {},
    cancTotal: 0,
    compraDiretaTotal: 0,
    compraDiretaMotivoMap: {},
    quebraTotal: 0,
    fechAbertos: 0,
    fechFechados: 5,
    fechConciliados: 5,
    ...overrides,
  };
}

// Porta fiel do resumo do legado (buildWhatsappText/computeWhatsappReport,
// linhas 4024-4097 do painel HTML) — mesmas condições e mesmos textos.
describe("buildResumo — porta fiel do legado", () => {
  it("sem caixas abertos e sem cancelamento relevante -> normalidade", () => {
    expect(buildResumo(relatorio())).toBe(
      "Dia dentro da normalidade operacional, sem apontamentos críticos."
    );
  });

  it("caixas em aberto -> menciona a contagem", () => {
    const r = relatorio({ fechAbertos: 2 });
    expect(buildResumo(r)).toBe("Dia com 2 caixa(s) ainda em aberto — vale atenção.");
  });

  it("cancelamento > 1% do faturamento -> menciona o percentual", () => {
    const r = relatorio({ cancTotal: 200, faturamentoTotal: 10000 }); // 2%
    expect(buildResumo(r)).toBe("Dia com cancelamentos em 2.0% do faturamento — vale atenção.");
  });

  it("cancelamento <= 1% NÃO aparece no resumo (limite exclusivo, > 1)", () => {
    const r = relatorio({ cancTotal: 100, faturamentoTotal: 10000 }); // exatamente 1%
    expect(buildResumo(r)).toBe("Dia dentro da normalidade operacional, sem apontamentos críticos.");
  });

  it("caixas abertos E cancelamento alto -> junta as duas partes com 'e'", () => {
    const r = relatorio({ fechAbertos: 1, cancTotal: 500, faturamentoTotal: 10000 }); // 5%
    expect(buildResumo(r)).toBe(
      "Dia com 1 caixa(s) ainda em aberto e cancelamentos em 5.0% do faturamento — vale atenção."
    );
  });

  it("cancTotal>0 mas faturamentoTotal=0 não gera divisão por zero nem entra no resumo", () => {
    const r = relatorio({ cancTotal: 500, faturamentoTotal: 0 });
    expect(buildResumo(r)).toBe("Dia dentro da normalidade operacional, sem apontamentos críticos.");
  });
});

describe("buildWhatsappText — estrutura e conteúdo do texto copiado", () => {
  it("inclui todas as seções na ordem do legado, sem Quebra nem Troco", () => {
    const texto = buildWhatsappText(relatorio());
    expect(texto).toContain("📊 ADM/FINANCEIRO · CAIXAS (FECHAMENTO DIÁRIO) — GRUPO LONDRINO");
    expect(texto).toContain("📅 27/09/2026");
    expect(texto).toContain("💰 Faturamento do dia:");
    expect(texto).toContain("💳 Formas de pagamento");
    expect(texto).toContain("🎁 Brindes do dia");
    expect(texto).toContain("❌ Cancelamento Delivery");
    expect(texto).toContain("❌ Cancelamento Salão");
    expect(texto).toContain("📌 Retirada Compra Direta");
    expect(texto).toContain("📦 Fechamento dos caixas");
    expect(texto).toContain("— Gestão Ragga · Financeiro");
    // Quebra de caixa e Troco não aparecem no texto (só na imagem, no legado)
    expect(texto).not.toMatch(/quebra/i);
    expect(texto).not.toMatch(/troco/i);
  });

  it("motivo vazio mostra 'Sem registros nesta data'", () => {
    const texto = buildWhatsappText(relatorio());
    expect(texto).toContain("- Sem registros nesta data");
  });

  it("motivos são ordenados por valor decrescente", () => {
    const r = relatorio({
      brindeMotivoMap: { "Aniversário": 50, "Fidelidade": 200, "Erro operacional": 100 },
    });
    const texto = buildWhatsappText(r);
    const idxFidelidade = texto.indexOf("Fidelidade");
    const idxErro = texto.indexOf("Erro operacional");
    const idxAniversario = texto.indexOf("Aniversário");
    expect(idxFidelidade).toBeLessThan(idxErro);
    expect(idxErro).toBeLessThan(idxAniversario);
  });

  it("Dinheiro/Outros só aparecem quando > 0,005 (tolerância do legado)", () => {
    const semValor = buildWhatsappText(relatorio());
    expect(semValor).not.toContain("Dinheiro:");
    expect(semValor).not.toContain("Outros:");

    const comValor = buildWhatsappText(
      relatorio({ formaBuckets: { ...relatorio().formaBuckets, dinheiro: 10, outros: 5 } })
    );
    expect(comValor).toContain("- Dinheiro:");
    expect(comValor).toContain("- Outros:");
  });
});
