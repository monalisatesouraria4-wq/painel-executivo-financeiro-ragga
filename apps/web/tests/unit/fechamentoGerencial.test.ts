import { describe, expect, it } from "vitest";
import type { CaixaAberturaFechamentoLinha } from "@/lib/services/aberturaFechamento";
import { agregarFechamento, situacaoLoja } from "@/lib/services/controlesLojaPainel";
import {
  abertoVencido,
  dataFechamentoISO,
  domingoDaSemana,
  hojeBrasilISO,
  horaFechamento,
  pendenciasPorLoja,
  prazoConciliacaoISO,
  prazoPendencia,
  resumirFechamentoGerencial,
  segundaDaSemana,
  semanaAnterior,
  semanaDe,
  statusConciliacao,
  totalDifereDaSoma,
} from "@/lib/services/fechamentoGerencial";

const HOJE = "2026-10-08"; // quinta-feira (dia da apresentação)

function l(p: Partial<CaixaAberturaFechamentoLinha> & { situacao: string }): CaixaAberturaFechamentoLinha {
  return {
    unidade: "BG 10",
    data: "2026-09-28",
    caixa: "BG10 - PDV 01",
    movimento: "1",
    operador: "OPERADOR",
    abertura: "10:00",
    fechamento: "28/09 18:00",
    fechado: p.situacao === "Fechado" || p.situacao === "Conciliado",
    difFechamento: 0,
    difConciliacao: 0,
    difTotal: 0,
    ...p,
  };
}

describe("situação oficial (nunca deduzida dos valores)", () => {
  it("usa exatamente `situacao`; Conciliado com Dif. conciliação 0,00 NÃO é pendente", () => {
    expect(statusConciliacao({ situacao: "Aberto" })).toBe("aberto");
    expect(statusConciliacao({ situacao: "Fechado" })).toBe("fechado-pendente");
    expect(statusConciliacao({ situacao: "Conciliado" })).toBe("conciliado");
    expect(statusConciliacao({ situacao: "" })).toBe("desconhecido");
    const r = resumirFechamentoGerencial([l({ situacao: "Conciliado", difConciliacao: 0 }), l({ situacao: "Conciliado", difConciliacao: null })], HOJE);
    expect(r.pendentes).toBe(0);
    expect(r.conciliados).toBe(2);
  });

  it("Fechado com Dif. conciliação 0,00 (preenchimento) continua pendente de conciliação", () => {
    const r = resumirFechamentoGerencial([l({ situacao: "Fechado", difConciliacao: 0 })], HOJE);
    expect([r.pendentes, r.conciliados, r.fechados]).toEqual([1, 0, 1]); // fechado operacionalmente E pendente
  });
});

describe("data real do fechamento (derivada do texto, sem inventar)", () => {
  it("mesmo dia, dia seguinte e virada de ano", () => {
    expect(dataFechamentoISO("2026-09-28", "28/09 18:06")).toBe("2026-09-28");
    expect(dataFechamentoISO("2026-09-28", "29/09 00:17")).toBe("2026-09-29");
    expect(dataFechamentoISO("2026-12-31", "01/01 00:10")).toBe("2027-01-01");
  });

  it("sem texto, formato desconhecido, data inválida ou anterior à abertura → null (nunca data padrão)", () => {
    expect(dataFechamentoISO("2026-09-28", null)).toBeNull();
    expect(dataFechamentoISO("2026-09-28", "")).toBeNull();
    expect(dataFechamentoISO("2026-09-28", "28-09 18:06")).toBeNull();
    expect(dataFechamentoISO("2026-09-28", "31/02 10:00")).toBeNull();
    expect(dataFechamentoISO("2026-09-28", "27/09 10:00")).toBeNull();
    expect(dataFechamentoISO(undefined, "28/09 10:00")).toBeNull();
  });

  it("hora do fechamento", () => {
    expect(horaFechamento("28/09 18:06")).toBe("18:06");
    expect(horaFechamento(null)).toBeNull();
    expect(horaFechamento("18:06")).toBeNull();
  });
});

describe("semana (segunda a domingo) e prazo de conciliação", () => {
  it("segunda/domingo da semana, inclusive quando a data é domingo", () => {
    expect(segundaDaSemana("2026-10-08")).toBe("2026-10-05"); // quinta
    expect(domingoDaSemana("2026-10-08")).toBe("2026-10-11");
    expect(segundaDaSemana("2026-10-04")).toBe("2026-09-28"); // domingo pertence à semana que termina nele
    expect(segundaDaSemana("2026-09-28")).toBe("2026-09-28");
  });

  it("semana anterior (apresentação de quinta 08/10 → 28/09 a 04/10) e semana atual", () => {
    expect(semanaAnterior(HOJE)).toEqual({ inicio: "2026-09-28", fim: "2026-10-04" });
    expect(semanaDe(HOJE)).toEqual({ inicio: "2026-10-05", fim: "2026-10-11" });
  });

  it("prazo = quarta-feira seguinte ao domingo da semana do caixa", () => {
    expect(prazoConciliacaoISO("2026-09-28")).toBe("2026-10-07");
    expect(prazoConciliacaoISO("2026-10-04")).toBe("2026-10-07");
    expect(prazoConciliacaoISO("2026-10-05")).toBe("2026-10-14");
  });

  it("Fechado da semana anterior vence após a quarta; da semana atual está no prazo; no próprio dia do prazo ainda está no prazo", () => {
    expect(prazoPendencia(l({ situacao: "Fechado", data: "2026-10-02" }), HOJE)).toEqual({ prazo: "2026-10-07", situacao: "vencida" });
    expect(prazoPendencia(l({ situacao: "Fechado", data: "2026-10-05" }), HOJE)).toEqual({ prazo: "2026-10-14", situacao: "no-prazo" });
    expect(prazoPendencia(l({ situacao: "Fechado", data: "2026-10-02" }), "2026-10-07")?.situacao).toBe("no-prazo");
    expect(prazoPendencia(l({ situacao: "Conciliado" }), HOJE)).toBeNull();
    expect(prazoPendencia(l({ situacao: "Aberto" }), HOJE)).toBeNull();
  });

  it("hoje no fuso de Brasília (não UTC)", () => {
    expect(hojeBrasilISO(new Date("2026-10-08T02:00:00Z"))).toBe("2026-10-07");
    expect(hojeBrasilISO(new Date("2026-10-08T15:00:00Z"))).toBe("2026-10-08");
  });
});

describe("resumo gerencial (cards)", () => {
  const linhas = [
    l({ situacao: "Conciliado", difFechamento: -39.3, difConciliacao: 29.45, difTotal: -9.85, caixa: "A" }),
    l({ situacao: "Conciliado", difFechamento: 0, difConciliacao: 0, difTotal: 0, caixa: "B" }),
    l({ situacao: "Conciliado", difFechamento: -302.63, difConciliacao: 78, difTotal: 0.37, caixa: "C" }), // total ≠ soma (como na base)
    l({ situacao: "Fechado", data: "2026-10-02", difFechamento: -10, difConciliacao: 0, difTotal: -10, caixa: "D" }), // vencida
    l({ situacao: "Fechado", data: "2026-10-06", difFechamento: 5, difConciliacao: 0, difTotal: 5, caixa: "E" }), // no prazo
    l({ situacao: "Fechado", data: "2026-10-03", difFechamento: null, difConciliacao: 0, difTotal: null, caixa: "F" }), // vencida, sem valor
    l({ situacao: "Aberto", data: "2026-10-07", fechamento: null, difFechamento: null, difConciliacao: 0, difTotal: null, caixa: "G" }), // dia anterior
    l({ situacao: "Aberto", data: "2026-10-08", fechamento: null, difFechamento: null, difConciliacao: 0, difTotal: null, caixa: "H" }), // hoje
  ];
  const r = resumirFechamentoGerencial(linhas, HOJE);

  it("contagens: fechados, em aberto, conciliados, pendentes (vencidas × no prazo) e em operação", () => {
    expect(r.registros).toBe(8);
    expect(r.conciliados).toBe(3);
    expect(r.pendentes).toBe(3);
    expect([r.pendentesVencidas, r.pendentesNoPrazo]).toEqual([2, 1]);
    expect(r.fechados).toBe(6); // Fechado + Conciliado
    expect(r.emAberto).toBe(1); // Aberto de 07/10
    expect(r.emOperacao).toBe(1); // Aberto de hoje não é atraso
  });

  it("fechados + em aberto + em operação + outras = registros (sem confundir conceitos)", () => {
    expect(r.fechados + r.emAberto + r.emOperacao + r.outrasSituacoes).toBe(r.registros);
    expect(r.conciliados + r.pendentes).toBe(r.fechados);
  });

  it("Diferença dos fechamentos = Σ Dif. fechamento; sem valor não entra e é contado", () => {
    expect(r.difFechamento).toBe(-39.3 + 0 - 302.63 - 10 + 5);
    expect(r.registrosSemDifFechamento).toBe(3); // F, G, H
  });

  it("Diferença após conciliação = Σ Dif. total só dos CONCILIADOS (campo da base)", () => {
    expect(r.difAposConciliacao).toBe(-9.85 + 0 + 0.37);
    expect(r.difTotalGeral).toBe(-9.85 + 0.37 - 10 + 5);
  });

  it("exemplo do enunciado: −39,30 + 29,45 = −9,85 confere; o registro com Dif. total ≠ soma é sinalizado, não corrigido", () => {
    expect(totalDifereDaSoma(linhas[0])).toBe(false);
    expect(totalDifereDaSoma(linhas[1])).toBe(false);
    expect(totalDifereDaSoma(linhas[2])).toBe(true);
    expect(totalDifereDaSoma(linhas[5])).toBeNull(); // sem valores: não dá para comparar
    expect(r.totalDifereDaSoma).toBe(1);
    expect(linhas[2].difTotal).toBe(0.37); // valor da base preservado
  });

  it("Aberto: só vira 'em aberto' quando o dia da abertura já passou", () => {
    expect(abertoVencido(l({ situacao: "Aberto", data: "2026-10-07" }), HOJE)).toBe(true);
    expect(abertoVencido(l({ situacao: "Aberto", data: "2026-10-08" }), HOJE)).toBe(false);
    expect(abertoVencido(l({ situacao: "Fechado" }), HOJE)).toBeNull();
  });

  it("pendências por loja: vencidas primeiro, com o caixa vencido mais antigo", () => {
    const p = pendenciasPorLoja(
      [
        l({ situacao: "Fechado", unidade: "BG 02", data: "2026-10-03" }),
        l({ situacao: "Fechado", unidade: "BG 02", data: "2026-09-28" }),
        l({ situacao: "Fechado", unidade: "BG 02", data: "2026-10-06" }),
        l({ situacao: "Fechado", unidade: "BG 10", data: "2026-10-06" }),
        l({ situacao: "Conciliado", unidade: "BG 10" }),
      ],
      HOJE
    );
    expect(p).toEqual([
      { unidade: "BG 02", vencidas: 2, noPrazo: 1, maisAntiga: "2026-09-28" },
      { unidade: "BG 10", vencidas: 0, noPrazo: 1, maisAntiga: null },
    ]);
  });
});

describe("comparação semanal (regra existente preservada)", () => {
  const semana = (valores: number[], unidade = "BG 10") => valores.map((v, i) => l({ situacao: "Conciliado", unidade: unidade as CaixaAberturaFechamentoLinha["unidade"], difTotal: v, caixa: `PDV ${i}` }));

  it("−R$ 1.351,41 contra −R$ 3.456,47: variação +R$ 2.105,06 e 'melhorou' (menos negativa), mas ainda há diferença", () => {
    const atual = agregarFechamento(semana([-1000, -351.41]));
    const anterior = agregarFechamento(semana([-3000, -456.47]));
    expect(atual.rede.valor).toBeCloseTo(-1351.41, 2);
    expect(anterior.rede.valor).toBeCloseTo(-3456.47, 2);
    expect(Math.round((atual.rede.valor - anterior.rede.valor) * 100) / 100).toBe(2105.06);
    expect(situacaoLoja(atual.rede, anterior.rede)).toBe("melhorou");
    expect(Math.abs(atual.rede.valor)).toBeGreaterThan(0); // ainda existe diferença a acompanhar
  });

  it("variação positiva NÃO é melhora automática: de −R$ 100 para +R$ 500 a diferença aumentou em módulo (piorou)", () => {
    const atual = agregarFechamento(semana([500]));
    const anterior = agregarFechamento(semana([-100]));
    expect(atual.rede.valor - anterior.rede.valor).toBe(600); // variação positiva...
    expect(situacaoLoja(atual.rede, anterior.rede)).toBe("piorou"); // ...mas piorou (mais longe de zero)
  });

  it("a expansão da loja soma as mesmas linhas do painel (Σ Dif. total = diferença da loja)", () => {
    const painel = agregarFechamento([...semana([-10, -20], "BG 10"), ...semana([5], "BG 02")]);
    const bg10 = painel.lojas.find((x) => x.unidade === "BG 10")!;
    expect(bg10.valor).toBe(-30);
    expect(bg10.detalhe.reduce((s, c) => s + (c.difTotal ?? 0), 0)).toBe(bg10.valor);
    expect(painel.rede.valor).toBe(-25);
  });
});
