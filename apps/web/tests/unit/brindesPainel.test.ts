import { describe, expect, it } from "vitest";
import { montarPeriodoBrindes, statusBrindes, LIMITE_SAUDAVEL_BRINDES, LIMITE_ATENCAO_BRINDES } from "@/lib/services/brindesPainel";
import { compararMotivos, variacaoCompraDireta } from "@/lib/services/compraDiretaPainel";

describe("semáforo de Brindes (thresholds existentes, só controláveis)", () => {
  it("até 0,25% excelente; até 0,40% atenção; acima crítico", () => {
    expect(LIMITE_SAUDAVEL_BRINDES).toBe(0.25);
    expect(LIMITE_ATENCAO_BRINDES).toBe(0.4);
    expect(statusBrindes(0.25).status).toBe("excelente");
    expect(statusBrindes(0.26).status).toBe("atencao");
    expect(statusBrindes(0.4).status).toBe("atencao");
    expect(statusBrindes(0.41).status).toBe("critico");
  });
});

describe("montarPeriodoBrindes", () => {
  // BG 01: faturamento 100.000 → controláveis 200 (0,20% = excelente); não controláveis 3.000 (3% — NÃO penaliza)
  // BG 02: faturamento 100.000 → controláveis 500 (0,50% = crítico)
  const fat = [
    { codigo: "BG 01", data: "2026-09-12", valor: 60000 },
    { codigo: "BG 01", data: "2026-09-13", valor: 40000 },
    { codigo: "BG 02", data: "2026-09-12", valor: 100000 },
  ];
  const br = [
    { codigo: "BG 01", data: "2026-09-12", motivo: "BRINDE PRESENTE", motivo2: "ERRO DE PRODUÇÃO", valor: 150 },
    { codigo: "BG 01", data: "2026-09-12", motivo: "BRINDE TAXA EXTRA", motivo2: "", valor: 50 },
    { codigo: "BG 01", data: "2026-09-12", motivo: "BRINDE ANIVERSARIANTE", motivo2: "BRINDE ANIVERSARIANTE", valor: 1000 },
    { codigo: "BG 01", data: "2026-09-13", motivo: "BRINDE CONSUMO FUNCIONARIOS", motivo2: "REFEIÇÃO COLABORADOR", valor: 1500 },
    { codigo: "BG 01", data: "2026-09-13", motivo: "BRINDE PRESENTE", motivo2: "DESCONTO EMPRESAS", valor: 500 }, // Presente + Desconto Empresas = NÃO controlável
    { codigo: "BG 02", data: "2026-09-12", motivo: "BRINDE PRESENTE", motivo2: "ERRO DE ATENDIMENTO", valor: 500 },
  ];
  const p = montarPeriodoBrindes("2026-09-12", "2026-09-13", fat, br);
  const bg01 = p.porLoja.find((l) => l.unidade === "BG 01")!;
  const bg02 = p.porLoja.find((l) => l.unidade === "BG 02")!;

  it("total = controláveis + não controláveis (loja e rede)", () => {
    expect(bg01.controlaveis).toBe(200);
    expect(bg01.naoControlaveis).toBe(3000);
    expect(bg01.total).toBe(bg01.controlaveis + bg01.naoControlaveis);
    expect(p.total).toBe(p.controlaveis + p.naoControlaveis);
    expect(p.total).toBe(3700);
  });

  it("status usa SOMENTE controláveis: não controláveis altos não penalizam; controláveis altos penalizam", () => {
    expect(bg01.percentualTotal).toBeGreaterThan(3); // total alto
    expect(bg01.percentualControlaveis).toBeCloseTo(0.2, 6);
    expect(bg01.status).toBe("excelente");
    expect(bg02.percentualControlaveis).toBeCloseTo(0.5, 6);
    expect(bg02.status).toBe("critico");
    expect(p.contagemStatus).toEqual({ excelente: 1, atencao: 0, critico: 1 });
  });

  it("classificação reutilizada: Presente + Desconto Empresas vira Empresas Parceiras (não controlável)", () => {
    const m = bg01.motivos.find((x) => x.motivo === "Empresas Parceiras");
    expect(m).toMatchObject({ controlavel: false, valor: 500 });
    expect(bg01.motivos.find((x) => x.motivo === "Presente")).toMatchObject({ controlavel: true, valor: 150 });
    expect(bg01.motivos.find((x) => x.motivo === "Aniversariante")?.controlavel).toBe(false);
    expect(bg01.motivos.find((x) => x.motivo === "Consumo Funcionários")?.controlavel).toBe(false);
  });

  it("composição do dia fecha em 100% e soma o total do dia", () => {
    const dia = bg01.diario[0]; // 12/09
    const soma = dia.motivos.reduce((s, m) => s + m.valor, 0);
    expect(soma).toBe(dia.valor);
    expect(dia.valor).toBe(1200);
    expect(dia.controlaveis + dia.naoControlaveis).toBe(dia.valor);
    expect(dia.motivos.reduce((s, m) => s + (m.valor / dia.valor) * 100, 0)).toBeCloseTo(100, 6);
    // rede no dia = soma das lojas
    const rede = p.diario[0];
    expect(rede.valor).toBe(1200 + 500);
    expect(rede.motivos.map((m) => m.motivo)).toEqual(["Aniversariante", "Presente", "Taxa Extra"]);
  });

  it("dias sem registro continuam sem dado (o gráfico os trata como lacuna)", () => {
    const vazio = montarPeriodoBrindes("2026-09-12", "2026-09-14", fat, br);
    const dia14 = vazio.porLoja.find((l) => l.unidade === "BG 01")!.diario[2];
    expect(dia14.faturamento).toBe(0);
    expect(dia14.valor).toBe(0);
    expect(dia14.motivos).toEqual([]);
  });

  it("sem registros de brindes → indisponível (não inventa zero)", () => {
    expect(montarPeriodoBrindes("2026-09-12", "2026-09-13", fat, []).disponivel).toBe(false);
  });
});

describe("variações de Brindes", () => {
  it("R$ e % sobre o comparado; menor = melhorou, maior = piorou", () => {
    const a = variacaoCompraDireta(1200, 1000);
    expect(a.delta).toBe(200);
    expect(a.percentual).toBeCloseTo(20, 6);
    expect(a.situacao).toBe("piorou");
    const b = variacaoCompraDireta(800, 1000);
    expect(b.delta).toBe(-200);
    expect(b.percentual).toBeCloseTo(-20, 6);
    expect(b.situacao).toBe("melhorou");
  });
  it("comparação por motivo une os motivos dos dois períodos", () => {
    const atual = [{ motivo: "Presente", valor: 10 }, { motivo: "Taxa Extra", valor: 5 }];
    const comp = [{ motivo: "Presente", valor: 8 }, { motivo: "Aniversariante", valor: 2 }];
    expect(compararMotivos(atual, comp).map((l) => l.motivo)).toEqual(["Presente", "Taxa Extra", "Aniversariante"]);
  });
});

describe("Melhorou/Piorou dos controláveis é pelo % sobre o faturamento (não pelo valor em R$)", () => {
  // atual: controláveis 700 sobre faturamento 200.000 = 0,35%; comparado: 400 sobre 100.000 = 0,40%
  const atual = montarPeriodoBrindes("2026-09-12", "2026-09-12", [{ codigo: "BG 01", data: "2026-09-12", valor: 200000 }], [
    { codigo: "BG 01", data: "2026-09-12", motivo: "BRINDE PRESENTE", motivo2: "ERRO DE PRODUÇÃO", valor: 700 },
  ]);
  const comp = montarPeriodoBrindes("2026-08-12", "2026-08-12", [{ codigo: "BG 01", data: "2026-08-12", valor: 100000 }], [
    { codigo: "BG 01", data: "2026-08-12", motivo: "BRINDE PRESENTE", motivo2: "ERRO DE PRODUÇÃO", valor: 400 },
  ]);
  it("valor em R$ subiu, % caiu → melhorou", () => {
    expect(atual.controlaveis).toBeGreaterThan(comp.controlaveis);
    expect(atual.percentualControlaveis).toBeCloseTo(0.35, 6);
    expect(comp.percentualControlaveis).toBeCloseTo(0.4, 6);
    expect(variacaoCompraDireta(atual.controlaveis, comp.controlaveis).situacao).toBe("piorou"); // regra ANTIGA (R$) — não é mais usada
    expect(variacaoCompraDireta(atual.percentualControlaveis, comp.percentualControlaveis).situacao).toBe("melhorou"); // regra atual (%)
  });
  it("% maior → piorou; % igual → sem alteração", () => {
    expect(variacaoCompraDireta(0.45, 0.4).situacao).toBe("piorou");
    expect(variacaoCompraDireta(0.4, 0.4).situacao).toBe("sem-alteracao");
  });
  it("o semáforo continua pelos thresholds existentes (0,35% = atenção; 0,40% = atenção)", () => {
    expect(atual.status).toBe("atencao");
    expect(comp.status).toBe("atencao");
  });
});
