import { describe, expect, it } from "vitest";
import { parseRetiradaDeposito } from "@/lib/import/parsers/retiradaDeposito";

const cabecalho = ["Filial", "Caixa", "Data", "Valor", "Motivo", "Motivo/Descrição", "Usuário", "Usuário autorizador"];

describe("parseRetiradaDeposito — só Motivo = DEPOSITO (fonte: Retirada Depósito.xlsx)", () => {
  it("inclui linhas com Motivo = DEPOSITO", () => {
    const linhas = [
      ["BG 01", "PDV 02", "14/09/2026", 400, "DEPOSITO", "DEPOSITO BANCARIO", "Fulano", "Fulano"],
    ];
    const resultado = parseRetiradaDeposito(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(1);
    expect(resultado.registros[0].valor).toBe(400);
  });

  it("exclui linhas com outras classificações (ex. SUPRIMENTO), reportando o motivo da exclusão", () => {
    const linhas = [
      ["BG 01", "PDV 02", "14/09/2026", 400, "SUPRIMENTO", "SUPRIMENTO PARA CAIXA", "Fulano", "Fulano"],
    ];
    const resultado = parseRetiradaDeposito(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(0);
    expect(resultado.rejeitados).toHaveLength(1);
    expect(resultado.rejeitados[0].motivo).toMatch(/SUPRIMENTO/);
    expect(resultado.rejeitados[0].motivo).toMatch(/fora do escopo/);
  });

  it("comparação de Motivo é insensível a acento/caixa (mesma regra do painel atual)", () => {
    const linhas = [["BG 01", "PDV 02", "14/09/2026", 400, "depósito", "x", "Fulano", "Fulano"]];
    const resultado = parseRetiradaDeposito(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(1);
  });

  it("mistura DEPOSITO e outras classificações no mesmo arquivo: só DEPOSITO conta", () => {
    const linhas = [
      ["BG 01", "PDV 01", "14/09/2026", 400, "DEPOSITO", "x", "A", "A"],
      ["BG 01", "PDV 02", "14/09/2026", 300, "SANGRIA", "x", "B", "B"],
      ["BG 02", "PDV 01", "15/09/2026", 500, "DEPOSITO", "x", "C", "C"],
    ];
    const resultado = parseRetiradaDeposito(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(2);
    expect(resultado.registros.reduce((s, r) => s + r.valor, 0)).toBe(900);
    expect(resultado.rejeitados).toHaveLength(1);
  });

  it("rejeita unidade não reconhecida normalmente (erro de dado, não de escopo)", () => {
    const linhas = [["LOJA X", "PDV 01", "14/09/2026", 400, "DEPOSITO", "x", "A", "A"]];
    const resultado = parseRetiradaDeposito(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(0);
    expect(resultado.rejeitados).toHaveLength(1);
    expect(resultado.rejeitados[0].motivo).toMatch(/Unidade não reconhecida/);
  });
});
