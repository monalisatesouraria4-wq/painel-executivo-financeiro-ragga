import { describe, expect, it } from "vitest";
import { classificarBrinde, resumirBrindes } from "@/lib/rules/brindes";
import { classificarSemaforo, FAIXAS_BRINDES } from "@/lib/rules/semaforos";
import { calcularPontosAtencao, compararCriticidade, contarCriticidade } from "@/lib/rules/prioridades";
import { comSemaforo, type LinhaDetalhamentoLoja } from "@/lib/services/visaoGeral";
import { FAIXAS_CANCELAMENTO, FAIXAS_COMPRA_DIRETA } from "@/lib/rules/semaforos";

describe("classificarBrinde", () => {
  it("separa não controláveis", () => {
    expect(classificarBrinde("BRINDE ANIVERSARIANTE")).toEqual({ controlavel: false, rotulo: "Aniversariante" });
    expect(classificarBrinde("BRINDE CONSUMO FUNCIONARIOS")).toEqual({ controlavel: false, rotulo: "Consumo Funcionários" });
    expect(classificarBrinde("TATA CONSULTANCY SERVICES").controlavel).toBe(false);
    expect(classificarBrinde("BANKME S/A").rotulo).toBe("Empresas Parceiras");
  });
  it("Presente, Taxa Extra e demais BRINDE * são controláveis", () => {
    expect(classificarBrinde("BRINDE PRESENTE")).toEqual({ controlavel: true, rotulo: "Presente" });
    expect(classificarBrinde("BRINDE TAXA EXTRA")).toEqual({ controlavel: true, rotulo: "Taxa Extra" });
    expect(classificarBrinde("BRINDE OUTRO MOTIVO").controlavel).toBe(true);
  });
});

describe("Desconto Empresas é sempre não controlável", () => {
  it("Presente + Desconto Empresas = não controlável", () => {
    expect(classificarBrinde("BRINDE PRESENTE", "DESCONTO EMPRESAS")).toEqual({ controlavel: false, rotulo: "Empresas Parceiras" });
    expect(classificarBrinde("BRINDE TAXA EXTRA", "Desconto Empresas").controlavel).toBe(false);
    expect(classificarBrinde("AGROPLAY MUSIC LTDA", "DESSCONTO EMPRESAS").controlavel).toBe(false);
  });
  it("Presente com outro submotivo segue controlável", () => {
    expect(classificarBrinde("BRINDE PRESENTE", "ERRO DE ATENDIMENTO").controlavel).toBe(true);
    expect(classificarBrinde("BRINDE PRESENTE", "").controlavel).toBe(true);
  });
  it("resumo move Presente + Desconto Empresas para não controláveis", () => {
    const d = resumirBrindes([
      { motivo: "BRINDE PRESENTE", motivo2: "DESCONTO EMPRESAS", valor: 200 },
      { motivo: "BRINDE PRESENTE", motivo2: "ERRO DE PRODUÇÃO", valor: 50 },
    ]);
    expect(d.controlaveis).toBe(50);
    expect(d.naoControlaveis).toBe(200);
    expect(d.composicaoNaoControlaveis).toEqual([{ rotulo: "Empresas Parceiras", valor: 200 }]);
  });
});

describe("resumirBrindes + semáforo", () => {
  const detalhe = resumirBrindes([
    { motivo: "BRINDE ANIVERSARIANTE", valor: 1000 },
    { motivo: "BRINDE CONSUMO FUNCIONARIOS", valor: 2000 },
    { motivo: "VECTRA", valor: 10 },
    { motivo: "BRINDE PRESENTE", valor: 100 },
    { motivo: "BRINDE TAXA EXTRA", valor: 50 },
  ]);
  it("totais", () => {
    expect(detalhe.total).toBe(3160);
    expect(detalhe.controlaveis).toBe(150);
    expect(detalhe.naoControlaveis).toBe(3010);
  });
  it("não controláveis não entram na criticidade; controláveis entram (mesmos thresholds)", () => {
    const fat = 100000;
    const sobreControlaveis = comSemaforo(detalhe.controlaveis, (detalhe.controlaveis / fat) * 100, FAIXAS_BRINDES);
    expect(sobreControlaveis.semaforo).toBe("azul"); // 0,15%
    expect(classificarSemaforo((detalhe.total / fat) * 100, FAIXAS_BRINDES)).toBe("vermelho"); // 3,16% — como seria antes
    const sobreOsControlaveisAltos = comSemaforo(500, (500 / fat) * 100, FAIXAS_BRINDES);
    expect(sobreOsControlaveisAltos.semaforo).toBe("vermelho"); // 0,5% > 0,4%
  });
});

function linha(unidade: string, p: { b?: number; cd?: number; cs?: number; cdl?: number }): LinhaDetalhamentoLoja {
  const fat = 1000;
  const mk = (pct: number | undefined, faixas: typeof FAIXAS_BRINDES) =>
    pct === undefined ? { disponivel: false } : comSemaforo((pct / 100) * fat, pct, faixas);
  return {
    unidade: unidade as never,
    faturamento: { disponivel: true, valor: fat },
    brindes: mk(p.b, FAIXAS_BRINDES),
    retiradaCompraDireta: mk(p.cd, FAIXAS_COMPRA_DIRETA),
    cancelamentoSalao: mk(p.cs, FAIXAS_CANCELAMENTO),
    cancelamentoDelivery: mk(p.cdl, FAIXAS_CANCELAMENTO),
  };
}

describe("prioridades e criticidade", () => {
  const linhas = [
    linha("BG 01", { b: 0.1, cd: 3, cs: 0.2, cdl: 0.2 }), // tudo ok
    linha("BG 02", { b: 0.5, cs: 3 }), // 2 críticos
    linha("BG 03", { cd: 6, cs: 1.5 }), // 2 atenção
    linha("BG 04", { cdl: 10 }), // 1 crítico
  ];
  it("Pontos de Atenção: por loja, críticos > atenção, só lojas com desvio", () => {
    const top = calcularPontosAtencao(linhas, 5);
    expect(top.map((p) => p.unidade)).toEqual(["BG 02", "BG 04", "BG 03"]);
    expect(top[0]).toMatchObject({ criticos: 2, atencao: 0 });
    expect(top[2]).toMatchObject({ criticos: 0, atencao: 2 });
    expect(top.some((p) => p.unidade === "BG 01")).toBe(false);
  });
  it("cada loja traz os indicadores responsáveis com valor, %, limite existente e distância em p.p.", () => {
    const [bg02] = calcularPontosAtencao([linha("BG 02", { cd: 8.22, b: 0.34 })], 5);
    const cd = bg02.indicadores.find((i) => i.rotulo === "Compra Direta");
    const br = bg02.indicadores.find((i) => i.rotulo === "Brindes");
    expect(cd).toMatchObject({ semaforo: "vermelho", limite: 5, percentual: 8.22 });
    expect(cd?.distanciaPp).toBeCloseTo(3.22, 2);
    expect(br).toMatchObject({ semaforo: "amarelo", limite: 0.25 });
    expect(br?.distanciaPp).toBeCloseTo(0.09, 2);
    expect(bg02.indicadores.map((i) => i.rotulo)).toEqual(["Compra Direta", "Brindes"]);
  });
  it("empate de contagem desempata pelo maior desvio e respeita o TOP N", () => {
    const l = [linha("BG 05", { cdl: 3 }), linha("BG 06", { cdl: 9 }), linha("BG 07", { cdl: 5 })];
    expect(calcularPontosAtencao(l, 2).map((p) => p.unidade)).toEqual(["BG 06", "BG 07"]);
  });
  it("ordenação por criticidade: usa contagem de semáforos, sem score", () => {
    expect(contarCriticidade(linhas[1])).toEqual({ criticos: 2, atencao: 0 });
    const ordenadas = [...linhas].sort(compararCriticidade).map((l) => l.unidade);
    expect(ordenadas).toEqual(["BG 02", "BG 04", "BG 03", "BG 01"]);
  });
});
