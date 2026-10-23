import { describe, expect, it } from "vitest";
import { agregarEmBuckets, classificarFormaPagamento, normalizarForma } from "@/lib/rules/formasPagamento";

/**
 * Regras oficiais de agrupamento das Formas de Pagamento (a descrição original continua guardada; só a apresentação consolida):
 * CRÉDITO, DÉBITO, PIX, VOUCHER e PAGAMENTO ONLINE agrupam a forma "de cartão/maquininha" com a variante TEF/iFood.
 */
describe("agrupamento das Formas de Pagamento", () => {
  it("CRÉDITO = CARTAO CREDITO + TEF - CREDITO", () => {
    expect(classificarFormaPagamento("CARTAO CREDITO")).toBe("credito");
    expect(classificarFormaPagamento("TEF - CREDITO")).toBe("credito");
  });
  it("DÉBITO = CARTAO DEBITO + TEF - DEBITO", () => {
    expect(classificarFormaPagamento("CARTAO DEBITO")).toBe("debito");
    expect(classificarFormaPagamento("TEF - DEBITO")).toBe("debito");
  });
  it("PIX = PIX MAQUININHA + TEF - PIX", () => {
    expect(classificarFormaPagamento("PIX MAQUININHA")).toBe("pix");
    expect(classificarFormaPagamento("TEF - PIX")).toBe("pix");
  });
  it("VOUCHER = VOUCHER + TEF - VOUCHER", () => {
    expect(classificarFormaPagamento("VOUCHER")).toBe("voucher");
    expect(classificarFormaPagamento("TEF - VOUCHER")).toBe("voucher");
  });
  it("PAGAMENTO ONLINE = Pagamento online + Cupom de desconto (Pago pelo iFood)", () => {
    expect(classificarFormaPagamento("Pagamento online")).toBe("online");
    expect(classificarFormaPagamento("Cupom de desconto (Pago pelo iFood)")).toBe("online");
  });
  it("as demais formas continuam como antes (Venda a prazo, Dinheiro) e o desconhecido cai em Outros", () => {
    expect(classificarFormaPagamento("Venda a prazo")).toBe("vendaAPrazo");
    expect(classificarFormaPagamento("DINHEIRO")).toBe("dinheiro");
    expect(classificarFormaPagamento("FORMA NOVA QUALQUER")).toBe("outros");
  });

  it("reconhece a descrição com maiúsculas/minúsculas e espaços diferentes, sem alterar o texto original", () => {
    const originais = ["  tef - credito ", "Tef  -  Pix", "TEF-DEBITO", "cartao  credito", "cupom de DESCONTO (pago pelo iFood) ", "pagamento ONLINE", "Voucher", "Venda A Prazo", "Cartão Débito"];
    const copia = [...originais];
    expect(classificarFormaPagamento(originais[0])).toBe("credito");
    expect(classificarFormaPagamento(originais[1])).toBe("pix");
    expect(classificarFormaPagamento(originais[2])).toBe("debito");
    expect(classificarFormaPagamento(originais[3])).toBe("credito");
    expect(classificarFormaPagamento(originais[4])).toBe("online");
    expect(classificarFormaPagamento(originais[5])).toBe("online");
    expect(classificarFormaPagamento(originais[6])).toBe("voucher");
    expect(classificarFormaPagamento(originais[7])).toBe("vendaAPrazo");
    expect(classificarFormaPagamento(originais[8])).toBe("debito");
    expect(originais).toEqual(copia); // nada é reescrito
    expect(normalizarForma("  tef  -  pix ")).toBe("TEF - PIX");
  });

  it("consolida os valores sem alterar as descrições e conta cada lançamento uma única vez (Σ categorias = Σ lançamentos)", () => {
    const linhas = [
      { forma: "CARTAO CREDITO", valor: 100 },
      { forma: "TEF - CREDITO", valor: 50 },
      { forma: "CARTAO DEBITO", valor: 30 },
      { forma: "TEF - DEBITO", valor: 20 },
      { forma: "PIX MAQUININHA", valor: 10 },
      { forma: "TEF - PIX", valor: 5 },
      { forma: "VOUCHER", valor: 7 },
      { forma: "TEF - VOUCHER", valor: 3 },
      { forma: "Pagamento online", valor: 200 },
      { forma: "Cupom de desconto (Pago pelo iFood)", valor: 8 },
      { forma: "Venda a prazo", valor: 40 },
      { forma: "DINHEIRO", valor: 60 },
    ];
    const antes = JSON.stringify(linhas);
    const b = agregarEmBuckets(linhas);
    expect(b).toMatchObject({ credito: 150, debito: 50, pix: 15, voucher: 10, online: 208, vendaAPrazo: 40, dinheiro: 60, outros: 0 });
    expect(Object.values(b).reduce((s, v) => s + v, 0)).toBe(linhas.reduce((s, l) => s + l.valor, 0));
    expect(JSON.stringify(linhas)).toBe(antes);
  });
});
