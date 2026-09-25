import { describe, expect, it } from "vitest";
import { detectarTipoBase } from "@/lib/import/detector";

/**
 * Cabeçalhos exatamente como observados nos arquivos reais do projeto
 * (Etapa 3) — apenas nomes de coluna, sem dados de negócio.
 */
describe("detectarTipoBase (por estrutura, não pelo nome do arquivo)", () => {
  it("BRINDES.xlsx", () => {
    const header = [
      "Loja", "Tipo", "Motivo", "Data", "Caixa", "Cupom", "Produto", "Valor",
      "Motivo 02", "Justificativa", "Site", "Taxa", "Responsavel",
    ];
    expect(detectarTipoBase(header)).toBe("brindes");
  });

  it("CANCEL SALÃO.xlsx", () => {
    const header = [
      "Filial", "Produto", "Comanda", "Qtde.", "Valor total", "Data/hora estorno",
      "Atendente lançamento", "Autorizador", "Motivo", "Justificativa", "SEM DESPERDICIO",
    ];
    expect(detectarTipoBase(header)).toBe("cancelamento_salao");
  });

  it("CANCELAMENTOS DELIVERY.xlsx", () => {
    const header = [
      "Filial", "Entregador", "Data/Hora", "Nr. pedido", "Tipo", "Cliente", "Endereço",
      "Bairro", "Taxa de entrega", "Custo logístico", "Total do pedido", "Entrega",
      "Tipo de pedido", "Status", "Motivo", "Justificativa", "Data/Hora entrega",
    ];
    expect(detectarTipoBase(header)).toBe("cancelamento_delivery");
  });

  it("COMPRA DIRETA.xlsx", () => {
    const header = [
      "Filial", "Caixa", "Data", "Valor", "Motivo", "Descrição", "Usuário", "Usuário autorizador",
    ];
    expect(detectarTipoBase(header)).toBe("compra_direta");
  });

  it("TROCO SEMANAL.xlsx", () => {
    const header = [
      "LOJA", "DATA", "CAIXA ", "R$ TROCO CONFERIDO PELO GERENTE",
      "R$ TROCO  INFORMADO PELO COLABORADOR", "DIFERENÇA TROCO ", "OPERADOR ", "PLANO DE AÇÃO ",
    ];
    expect(detectarTipoBase(header)).toBe("troco");
  });

  it("FECHAMENTO DE CAIXA - ABERTOS_FECHADOS_CONCILIADOS", () => {
    const header = [
      "Data", "Filial", "Caixa", "Movto.", "Abertura", "Fechamento", "Operador",
      "Situação", "Dif. fech.", "Dif. conc.", "Dif. total",
    ];
    expect(detectarTipoBase(header)).toBe("fechamento_caixa");
  });

  it("NÃO confunde retirada_deposito (aba 'coud', Motivo/Descrição em uma célula só) com compra_direta", () => {
    const header = ["Filial", "Caixa", "Data", "Valor", "Motivo/Descrição", "Usuário", "Usuário autorizador"];
    expect(detectarTipoBase(header)).not.toBe("compra_direta");
    // Nenhuma assinatura cobre retirada_deposito ainda (pendência —
    // múltiplos arquivos/formatos candidatos, ver docs/regras-negocio.md).
    expect(detectarTipoBase(header)).toBeNull();
  });

  it("cabeçalho desconhecido retorna null (nunca adivinha)", () => {
    expect(detectarTipoBase(["Coluna A", "Coluna B"])).toBeNull();
  });
});
