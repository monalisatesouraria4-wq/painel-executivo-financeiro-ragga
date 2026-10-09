import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { UNIDADES } from "@painel/shared";
import { semanaRealDoPeriodo } from "@/lib/rules/datas";
import { resumirTroco } from "@/lib/services/trocoIndicadores";
import {
  analisarSemanaTroco,
  avisoCoberturaFaltas,
  caixaNaoConferido,
  compararSemanasTroco,
  hojeBrasilISO,
  prazoConferenciaISO,
  rankingFaltasSemana,
  resumoLojasNaoConferidas,
  semanaAnteriorISO,
  semanaRealISO,
  statusCaixaTroco,
  type CaixaTrocoSemana,
} from "@/lib/services/trocoSemanal";

const SEMANA = "2026-09-21"; // segunda; prazo = quarta 23/09
const ANTERIOR = "2026-09-14";
const cx = (unidade: string, caixa: string, conferido: number, informado: number, data = "2026-09-23", plano: string | null = null, operador: string | null = "OP"): CaixaTrocoSemana => ({
  unidade,
  caixa,
  data,
  conferido,
  informado,
  diferenca: Math.round((conferido - informado) * 100) / 100,
  operador,
  planoDeAcao: plano,
});
const antes = "2026-09-22"; // terça: dentro do prazo
const depois = "2026-09-24"; // quinta: prazo encerrado
const rodar = (linhas: CaixaTrocoSemana[], hoje = antes, inicioSemana = SEMANA, universo?: string[]) => analisarSemanaTroco({ linhas, inicioSemana, hoje, universo });
const loja = (r: ReturnType<typeof rodar>, u: string) => r.lojas.find((l) => l.unidade === u)!;

describe("semana real, prazo e data (sem D-2)", () => {
  it("segunda a domingo; domingo pertence à semana que termina nele; prazo = quarta da própria semana", () => {
    expect(semanaRealISO("2026-09-23")).toEqual({ inicio: "2026-09-21", fim: "2026-09-27" });
    expect(semanaRealISO("2026-09-27")).toEqual({ inicio: "2026-09-21", fim: "2026-09-27" });
    expect(semanaRealISO("2026-09-21")).toEqual({ inicio: "2026-09-21", fim: "2026-09-27" });
    expect(prazoConferenciaISO("2026-09-21")).toBe("2026-09-23");
    expect(semanaAnteriorISO("2026-09-21")).toEqual({ inicio: "2026-09-14", fim: "2026-09-20" });
  });
  it("hoje no fuso de Brasília", () => {
    expect(hojeBrasilISO(new Date("2026-09-24T02:00:00Z"))).toBe("2026-09-23");
  });
});

describe("caixa conferido × não conferido (0/0)", () => {
  it("0/0 = não conferido; qualquer valor ≠ 0 mostra conferência; status por sinal da diferença", () => {
    expect(caixaNaoConferido({ conferido: 0, informado: 0 })).toBe(true);
    expect(caixaNaoConferido({ conferido: 100, informado: 100 })).toBe(false);
    expect(statusCaixaTroco(cx("BG 01", "A", 0, 0))).toBe("nao-conferido");
    expect(statusCaixaTroco(cx("BG 01", "A", 100, 100))).toBe("conferido");
    expect(statusCaixaTroco(cx("BG 01", "A", 90, 100))).toBe("falta"); // conferido − informado < 0
    expect(statusCaixaTroco(cx("BG 01", "A", 110, 100))).toBe("sobra");
  });
});

describe("situação da loja na semana", () => {
  it("1) loja com TODOS os caixas em 0/0 é pendente", () => {
    const r = rodar([cx("BG 05", "SALÃO", 0, 0), cx("BG 05", "DELIVERY", 0, 0), cx("BG 01", "SALÃO", 100, 100)]);
    expect(loja(r, "BG 05").situacao).toBe("pendente");
    expect(loja(r, "BG 05").naoConferidos).toBe(2);
  });

  it("2) loja sem linhas na semana é SEM REGISTRO (não é pendente nem atrasada, nem em 0/0)", () => {
    const r = rodar([cx("BG 01", "SALÃO", 100, 100)], depois); // mesmo com o prazo vencido
    expect(loja(r, "BG 02").situacao).toBe("sem-registro");
    expect(loja(r, "BG 02").total).toBe(0);
    expect(r.semRegistro).toBe(16);
    expect(r.atrasadas).toBe(0);
  });

  it("semana sem nenhuma linha = semana NÃO carregada: todas sem registro, nenhum valor", () => {
    const r = rodar([], depois);
    expect(r.semanaCarregada).toBe(false);
    expect(r.semRegistro).toBe(17);
    expect([r.conferidas, r.pendentes, r.atrasadas]).toEqual([0, 0, 0]);
    expect([r.valorFaltas, r.valorSobras, r.caixasComFalta]).toEqual([0, 0, 0]);
    // linhas de OUTRA semana não contam
    expect(rodar([cx("BG 01", "A", 100, 100, "2026-09-16")], depois).semanaCarregada).toBe(false);
  });

  it("3) loja parcialmente conferida continua CONFERIDA; os caixas 0/0 ficam em observação separada", () => {
    const r = rodar([cx("BG 07", "SALÃO", 500, 500), cx("BG 07", "DELIVERY", 0, 0), cx("BG 07", "STREET", 0, 0)], depois);
    const l = loja(r, "BG 07");
    expect(l.situacao).toBe("conferida"); // mesmo depois do prazo
    expect(l.naoConferidos).toBe(2);
    expect(l.caixasNaoConferidos).toEqual(["DELIVERY", "STREET"]);
    expect(r.caixasNaoConferidosEmLojasConferidas).toBe(2);
    expect(r.pendentes + r.atrasadas).toBe(0); // não virou pendente
  });

  it("'Lojas conferidas: X de 17' conta só lojas conferidas", () => {
    const r = rodar([cx("BG 01", "A", 10, 10), cx("BG 02", "A", 0, 0), cx("BG 03", "A", 5, 5)]);
    expect(r.universo).toBe(17);
    expect(r.conferidas).toBe(2);
    expect([r.pendentes, r.atrasadas, r.semRegistro]).toEqual([1, 0, 14]);
  });

  it("filtro de loja: o universo é só ela", () => {
    const r = rodar([cx("BG 01", "A", 10, 10)], antes, SEMANA, ["BG 01"]);
    expect(r.universo).toBe(1);
    expect(r.conferidas).toBe(1);
  });
});

describe("prazo (quarta-feira)", () => {
  const linhas = [cx("BG 05", "A", 0, 0), cx("BG 01", "A", 10, 10)];

  it("7) antes do prazo — e na própria quarta — a pendência NÃO é atrasada", () => {
    for (const hoje of ["2026-09-21", "2026-09-22", "2026-09-23"]) {
      const r = rodar(linhas, hoje);
      expect(r.prazoEncerrado).toBe(false);
      expect(loja(r, "BG 05").situacao).toBe("pendente");
      expect(r.atrasadas).toBe(0);
      expect(r.pendentes).toBe(1);
    }
  });

  it("8) depois da quarta-feira a pendência é ATRASADA", () => {
    for (const hoje of ["2026-09-24", "2026-09-27", "2026-10-08"]) {
      const r = rodar(linhas, hoje);
      expect(r.prazoEncerrado).toBe(true);
      expect(loja(r, "BG 05").situacao).toBe("atrasada");
      expect([r.pendentes, r.atrasadas]).toEqual([0, 1]);
    }
  });

  it("loja conferida nunca vira atrasada, nem depois do prazo", () => {
    expect(loja(rodar(linhas, "2026-10-08"), "BG 01").situacao).toBe("conferida");
  });
});

describe("faltas e sobras", () => {
  it("4) falta negativa é encaminhada para a Quebra pelo VALOR ABSOLUTO", () => {
    const r = rodar([cx("BG 01", "GERENTE", 83.1, 100)]); // dif −16,90
    expect(loja(r, "BG 01").valorFalta).toBe(16.9);
    expect(r.valorFaltas).toBe(16.9);
    expect([r.lojasComFalta, r.caixasComFalta]).toEqual([1, 1]);
  });

  it("5) sobra positiva NÃO é somada às faltas — vai para indicador separado", () => {
    const r = rodar([cx("BG 02", "A", 105, 100), cx("BG 02", "B", 100, 100)]);
    expect(r.valorFaltas).toBe(0);
    expect(r.caixasComFalta).toBe(0);
    expect([r.caixasComSobra, r.valorSobras]).toEqual([1, 5]);
    expect(rankingFaltasSemana(r.lojas)).toEqual([]); // sobra não é listada como falta
  });

  it("6) faltas e sobras simultâneas NÃO se compensam (nem na loja, nem na rede)", () => {
    const r = rodar([cx("BG 03", "A", 90, 100), cx("BG 03", "B", 130, 100), cx("BG 04", "A", 100, 100)]);
    const l = loja(r, "BG 03");
    expect([l.comFalta, l.valorFalta, l.comSobra, l.valorSobra]).toEqual([1, 10, 1, 30]);
    expect(r.valorFaltas).toBe(10); // e não 10 − 30 nem líquido
    expect(r.valorSobras).toBe(30);
  });

  it("plano de ação da falta é exibido exatamente como na base (sem repetir o mesmo texto; ignora vazio)", () => {
    const plano = "Quebra lançada para a op.";
    const r = rodar([cx("BG 01", "A", 91, 100, "2026-09-23", plano), cx("BG 01", "B", 95, 100, "2026-09-23", plano), cx("BG 01", "C", 99, 100, "2026-09-23", "  "), cx("BG 01", "D", 120, 100, "2026-09-23", "plano de sobra")]);
    expect(loja(r, "BG 01").planos).toEqual([plano]); // plano de sobra não entra; texto original intacto
  });

  it("ranking: maior falta financeira primeiro; empate por nº de caixas e depois loja; só lojas com falta", () => {
    const r = rodar([
      cx("BG 03", "A", 70, 100), // −30
      cx("BG 01", "A", 90, 100), // −10
      cx("BG 01", "B", 90, 100), // −10 (total 20, 2 caixas)
      cx("BG 02", "A", 80, 100), // −20 (1 caixa)
      cx("BG 04", "A", 100, 100),
    ]);
    expect(rankingFaltasSemana(r.lojas).map((x) => [x.unidade, x.valorFalta, x.caixasComFalta])).toEqual([
      ["BG 03", 30, 1],
      ["BG 01", 20, 2], // empata em R$ 20 com BG 02, mas tem mais caixas
      ["BG 02", 20, 1],
    ]);
  });
});

describe("comparação semanal evidencia a cobertura", () => {
  // semana anterior: BG 05 e BG 06 conferidas; BG 07 pendente; BG 08 E 09 sem registro
  const antLinhas = [cx("BG 05", "A", 50, 100, "2026-09-16"), cx("BG 06", "A", 100, 100, "2026-09-16"), cx("BG 07", "A", 0, 0, "2026-09-16"), cx("BG 01", "A", 100, 100, "2026-09-16")];
  // semana atual: BG 05 conferida com falta menor; BG 06 pendente; BG 07 conferida; BG 01 conferida
  const atuLinhas = [cx("BG 05", "A", 90, 100), cx("BG 06", "A", 0, 0), cx("BG 07", "A", 100, 100), cx("BG 01", "A", 100, 100)];
  const hoje = "2026-10-08";
  const ant = analisarSemanaTroco({ linhas: antLinhas, inicioSemana: ANTERIOR, hoje });
  const atu = analisarSemanaTroco({ linhas: atuLinhas, inicioSemana: SEMANA, hoje });
  const c = compararSemanasTroco(atu, ant);

  it("9) mostra a cobertura de cada semana e as lojas cuja situação mudou", () => {
    expect(c.coberturaAtual).toMatchObject({ conferidas: 3, pendentes: 0, atrasadas: 1, semRegistro: 13 });
    expect(c.coberturaAnterior).toMatchObject({ conferidas: 3, pendentes: 0, atrasadas: 1, semRegistro: 13 });
    expect(c.coberturaDiferente).toBe(true);
    expect(c.lojasComCoberturaDiferente.sort()).toEqual(["BG 06", "BG 07"]);
    expect(c.linhas.find((l) => l.unidade === "BG 06")).toMatchObject({ situacaoAtual: "atrasada", situacaoAnterior: "conferida", faltaAtual: null, comparavel: false });
    expect(c.linhas.find((l) => l.unidade === "BG 07")).toMatchObject({ situacaoAtual: "conferida", situacaoAnterior: "atrasada", faltaAnterior: null, comparavel: false });
  });

  it("os totais de falta aparecem, mas só as lojas conferidas nas DUAS semanas são comparáveis", () => {
    expect([c.faltasAtual, c.faltasAnterior, c.variacaoTotal]).toEqual([10, 50, -40]);
    expect(c.comparavel).toEqual({ lojas: 2, faltasAtual: 10, faltasAnterior: 50, variacao: -40 }); // BG 05 e BG 01
    expect(c.linhas.find((l) => l.unidade === "BG 05")!.variacao).toBe(-40);
  });

  it("a ressalva explica que a diferença pode refletir lojas pendentes/atrasadas/sem registro — e a leitura é neutra", () => {
    expect(c.ressalva).toMatch(/Cobertura da conferência/);
    expect(c.ressalva).toMatch(/pode refletir isso/);
    expect(c.ressalva).toMatch(/BG 06, BG 07|BG 07, BG 06/);
    expect(c.leitura).toBe("diminuiram");
    expect(JSON.stringify(c)).not.toMatch(/Melhorou|Piorou/i);
  });

  it("semana com lojas pendentes NÃO é apresentada como melhora sem ressalva (mesmo com faltas zeradas)", () => {
    const todasPendentes = analisarSemanaTroco({ linhas: [cx("BG 05", "A", 0, 0), cx("BG 06", "A", 0, 0)], inicioSemana: SEMANA, hoje });
    const cmp = compararSemanasTroco(todasPendentes, ant);
    expect(cmp.faltasAtual).toBe(0); // sem diferença financeira...
    expect(cmp.ressalva).not.toBeNull(); // ...mas a ressalva de cobertura está lá
    expect(cmp.comparavel.lojas).toBe(0);
    expect(cmp.leitura).toBe("indisponivel"); // sem lojas comparáveis, não há leitura
  });

  it("semana anterior sem registro: não há base de comparação e nada vira zero", () => {
    const semBase = analisarSemanaTroco({ linhas: [], inicioSemana: ANTERIOR, hoje });
    const cmp = compararSemanasTroco(atu, semBase);
    expect(cmp.ressalva).toMatch(/semana anterior não tem registro/);
    expect(cmp.leitura).toBe("indisponivel");
    expect(cmp.linhas.every((l) => l.faltaAnterior === null)).toBe(true);
  });

  it("cobertura igual e completa: sem ressalva e leitura pelo valor", () => {
    const todas = (inicio: string, data: string, falta: number) => analisarSemanaTroco({ linhas: UNIDADES.map((u) => cx(u as string, "A", 100 - (u === "BG 01" ? falta : 0), 100, data)), inicioSemana: inicio, hoje });
    const cmp = compararSemanasTroco(todas(SEMANA, "2026-09-23", 20), todas(ANTERIOR, "2026-09-16", 5));
    expect(cmp.ressalva).toBeNull();
    expect(cmp.leitura).toBe("aumentaram");
    expect(cmp.comparavel.variacao).toBe(15);
  });
});

describe("10) nenhuma alteração nos indicadores das outras abas", () => {
  it("o módulo do Troco semanal não importa nem altera módulos compartilhados com outras abas", () => {
    const fonte = readFileSync("lib/services/trocoSemanal.ts", "utf-8");
    expect(fonte).not.toMatch(/from "@\/lib\/services\/(trocoIndicadores|controlesCaixa|controlesLojaPainel|fechamentoGerencial|pdvEscopo)"/);
    expect(fonte).not.toMatch(/dataDMenos2|dataDMenos1/); // sem D-2
  });

  it("funções compartilhadas continuam com o mesmo resultado (regressão)", () => {
    expect(semanaRealDoPeriodo(new Date("2026-09-23T00:00:00Z"))).toEqual({ inicio: new Date("2026-09-21T00:00:00Z"), fim: new Date("2026-09-27T00:00:00Z") });
    const r = resumirTroco([
      { conferido: 90, informado: 100, diferenca: -10, planoDeAcao: null },
      { conferido: 110, informado: 100, diferenca: 10, planoDeAcao: null },
      { conferido: 0, informado: 0, diferenca: 0, planoDeAcao: null },
    ]);
    expect(r).toMatchObject({ total: 3, semValor: 1, faltas: { quantidade: 1, valor: 10 }, sobras: { quantidade: 1, valor: 10 } });
  });
});

describe("card 'Lojas não conferidas' (seção A simplificada — só apresentação)", () => {
  it("atrasadas: '2 lojas' e '2 atrasadas — BG 02 e BG 07' (depois da quarta); loja parcial NÃO conta", () => {
    const r = rodar(
      [cx("BG 02", "A", 0, 0), cx("BG 02", "B", 0, 0), cx("BG 07", "A", 0, 0), cx("BG 05", "A", 100, 100), cx("BG 05", "B", 0, 0), cx("BG 01", "A", 10, 10)],
      depois
    );
    const t = resumoLojasNaoConferidas(r);
    expect(t.valor).toBe("2 lojas");
    expect(t.auxiliar).toContain("2 atrasadas — BG 02 e BG 07");
    expect(t.auxiliar).not.toContain("BG 05"); // parcialmente conferida = conferida
    expect(r.conferidas).toBe(2); // BG 05 e BG 01
  });

  it("dentro do prazo as lojas são 'pendentes no prazo' (não atrasadas)", () => {
    const t = resumoLojasNaoConferidas(rodar([cx("BG 02", "A", 0, 0), cx("BG 01", "A", 10, 10)], antes));
    expect(t.valor).toBe("1 loja");
    expect(t.auxiliar).toContain("1 pendente no prazo — BG 02");
    expect(t.auxiliar).not.toMatch(/atrasada/);
  });

  it("lojas sem registro ficam SEPARADAS no texto auxiliar (e não entram no valor nem viram atrasadas)", () => {
    const r = rodar([cx("BG 02", "A", 0, 0), cx("BG 01", "A", 10, 10)], depois, SEMANA, ["BG 01", "BG 02", "BG 03"]);
    const t = resumoLojasNaoConferidas(r);
    expect(t.valor).toBe("1 loja");
    expect(t.auxiliar).toBe("1 atrasada — BG 02 · 1 sem registro na base — BG 03");
  });

  it("todas conferidas: '0 lojas' com a mensagem de que todas as lojas com registro foram conferidas", () => {
    const t = resumoLojasNaoConferidas(rodar([cx("BG 01", "A", 10, 10), cx("BG 02", "A", 20, 20)], depois, SEMANA, ["BG 01", "BG 02"]));
    expect(t).toEqual({ valor: "0 lojas", auxiliar: "Todas as lojas com registro foram conferidas" });
  });

  it("semana não carregada: sem valor e nenhuma loja vira atrasada", () => {
    const r = rodar([], depois, "2026-10-05");
    const t = resumoLojasNaoConferidas(r);
    expect(t.valor).toBe("—");
    expect(t.auxiliar).toBe("Semana ainda não carregada na base: 17 lojas sem registro.");
    expect(r.atrasadas).toBe(0);
  });
});

describe("aviso de cobertura das faltas (seção B) — só apresentação, calculado da classificação existente", () => {
  const todas = UNIDADES as readonly string[];
  const conferidas = (qtd: number) => todas.slice(0, qtd).map((u) => cx(u, "SALÃO DIURNO", 100, 100));
  const naoConf = (de: number, ate: number) => todas.slice(de, ate).map((u) => cx(u, "SALÃO DIURNO", 0, 0));

  it("8 de 17 conferidas e 9 pendentes/atrasadas: usa os números reais (não fixos) e esclarece o zero", () => {
    const r = rodar([...conferidas(8), ...naoConf(8, 17)], depois);
    expect([r.conferidas, r.atrasadas, r.universo]).toEqual([8, 9, 17]);
    const a = avisoCoberturaFaltas(r)!;
    expect(a.completa).toBe(false);
    expect(a.texto).toBe("Faltas apuradas em 8 de 17 lojas. 9 lojas ainda estão pendentes de conferência.");
    expect(a.esclarecimento).toMatch(/efetivamente conferidas/);
  });

  it("pendentes no prazo também contam; sem registro é citado à parte", () => {
    const r = rodar([...conferidas(10), ...naoConf(10, 12)], antes); // 2 pendentes no prazo, 5 sem registro
    const a = avisoCoberturaFaltas(r)!;
    expect(a.texto).toBe("Faltas apuradas em 10 de 17 lojas. 7 lojas ainda estão pendentes de conferência (5 sem registro na base).");
  });

  it("singular: 1 loja pendente", () => {
    const r = rodar([...conferidas(16), ...naoConf(16, 17)], depois);
    expect(avisoCoberturaFaltas(r)!.texto).toBe("Faltas apuradas em 16 de 17 lojas. 1 loja ainda está pendente de conferência.");
  });

  it("todas as lojas conferidas: apuração completa, sem esclarecimento de cobertura parcial", () => {
    const r = rodar(conferidas(17), depois);
    const a = avisoCoberturaFaltas(r)!;
    expect(a.completa).toBe(true);
    expect(a.texto).toMatch(/Apuração completa/);
    expect(a.esclarecimento).toBeNull();
  });

  it("semana sem dados: nenhum aviso que sugira apuração concluída", () => {
    expect(avisoCoberturaFaltas(rodar([], depois))).toBeNull();
  });

  it("com faltas e sobras registradas, os valores e cálculos continuam exatamente os mesmos", () => {
    const linhas = [cx("BG 01", "A", 90, 100), cx("BG 01", "B", 105, 100), cx("BG 02", "A", 0, 0)];
    const r = rodar(linhas, depois);
    expect([r.lojasComFalta, r.caixasComFalta, r.valorFaltas, r.caixasComSobra, r.valorSobras]).toEqual([1, 1, 10, 1, 5]);
    expect(avisoCoberturaFaltas(r)!.texto).toBe("Faltas apuradas em 1 de 17 lojas. 16 lojas ainda estão pendentes de conferência (15 sem registro na base).");
    expect(rodar(linhas, depois).valorFaltas).toBe(10);
  });

  it("filtro de loja: o universo é só a loja", () => {
    const r = rodar([cx("BG 02", "A", 0, 0)], depois, SEMANA, ["BG 02"]);
    expect(avisoCoberturaFaltas(r)!.texto).toBe("Faltas apuradas em 0 de 1 loja. 1 loja ainda está pendente de conferência.");
  });
});
