import { describe, expect, it } from "vitest";
import { CHAVES_POR_BASE } from "@/lib/rules/chaves";
import { chaveNaturalQuebra, chaveOficialQuebra, chavesOficiaisRepetidas, numerarOcorrenciasQuebra } from "@/lib/import/ocorrenciaQuebra";
import { lerQuebraDaPlanilha } from "@/lib/import/quebraDaPlanilha";
import { simularGravacao } from "@/lib/import/simularGravacao";
import type { RegistroBase } from "@/lib/import/tipos";

/** Quebra de Caixa: identificação por OCORRÊNCIA (dados 100% fictícios). */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const r = (unidade: string, data: string, valor: number, operador: string, linhaOrigem: number, motivo = "ERRO DE DESPACHO"): RegistroBase => ({
  unidade: unidade as RegistroBase["unidade"], data: d(data), valor, linhaOrigem, extras: { conferente: "MONALISA", operador, cpf: "111", motivo },
});
const ocorr = (rs: RegistroBase[]) => rs.map((x) => `${x.linhaOrigem}:${x.extras.ocorrencia}:${x.valor}`);
const total = (rs: RegistroBase[]) => Math.round(rs.reduce((a, x) => a + x.valor, 0) * 100) / 100;

describe("chave oficial da Quebra de Caixa", () => {
  it("natural + ocorrência; o VALOR continua fora da chave", () => {
    expect(CHAVES_POR_BASE.quebra_caixa).toEqual(["unidade_id", "data", "conferente", "operador", "cpf", "motivo", "ocorrencia"]);
    expect(CHAVES_POR_BASE.quebra_caixa).not.toContain("valor");
  });
});

describe("numerarOcorrenciasQuebra — uma, duas e cinco ocorrências com a mesma chave natural", () => {
  it("1 ocorrência → ocorrência 1", () => {
    expect(ocorr(numerarOcorrenciasQuebra([r("BG 07", "2026-10-04", 6.5, "OPERADORA UM", 55)]))).toEqual(["55:1:6.5"]);
  });
  it("2 ocorrências iguais (linhas 29 e 30: R$ 7,00 ×2) → ocorrências 1 e 2, ambas preservadas", () => {
    const n = numerarOcorrenciasQuebra([r("BG 07", "2026-09-27", 7, "OPERADOR DOIS", 29), r("BG 07", "2026-09-27", 7, "OPERADOR DOIS", 30)]);
    expect(ocorr(n)).toEqual(["29:1:7", "30:2:7"]);
    expect(chavesOficiaisRepetidas(n)).toEqual([]);
    expect(total(n)).toBe(14);
  });
  it("5 ocorrências iguais (linhas 55 a 59: R$ 6,50 ×5) → ocorrências 1 a 5; total R$ 32,50 preservado", () => {
    const n = numerarOcorrenciasQuebra([55, 56, 57, 58, 59].map((l) => r("BG 07", "2026-10-04", 6.5, "OPERADORA UM", l)));
    expect(n.map((x) => x.extras.ocorrencia)).toEqual(["1", "2", "3", "4", "5"]);
    expect(new Set(n.map(chaveOficialQuebra)).size).toBe(5);
    expect(total(n)).toBe(32.5);
  });
  it("valores diferentes na mesma chave natural (55,30 e 6,50): ordem por valor crescente, nada é somado", () => {
    const n = numerarOcorrenciasQuebra([r("BG 02", "2026-09-07", 55.3, "OPERADORA TRES", 120, "BRINDE"), r("BG 02", "2026-09-07", 6.5, "OPERADORA TRES", 121, "BRINDE")]);
    expect(ocorr(n)).toEqual(["120:2:55.3", "121:1:6.5"]);
  });
  it("não altera data, valor, loja nem campos de chave; mantém a ordem original; chave natural distinta não compartilha ocorrência", () => {
    const entrada = [r("BG 01", "2026-10-04", 1, "A", 5), r("BG 07", "2026-10-04", 1, "A", 6), r("BG 07", "2026-10-05", 1, "A", 7)];
    const n = numerarOcorrenciasQuebra(entrada);
    expect(n.map((x) => x.linhaOrigem)).toEqual([5, 6, 7]);
    expect(n.every((x, i) => x.valor === entrada[i].valor && +x.data === +entrada[i].data && x.unidade === entrada[i].unidade)).toBe(true);
    expect(n.map((x) => x.extras.ocorrencia)).toEqual(["1", "1", "1"]);
  });
});

describe("estabilidade da identificação", () => {
  const base = [r("BG 07", "2026-10-04", 6.5, "OPERADORA UM", 55), r("BG 07", "2026-10-04", 6.5, "OPERADORA UM", 56), r("BG 07", "2026-10-04", 9, "OPERADORA UM", 57), r("BG 01", "2026-10-04", 3, "LUZ", 58)];
  const chaves = (rs: RegistroBase[]) => numerarOcorrenciasQuebra(rs).map((x) => `${chaveOficialQuebra(x)}=${x.valor}`).sort();

  it("REORDENAÇÃO das linhas (e outros números de linha) gera exatamente as mesmas chaves e valores", () => {
    const embaralhado = [base[3], base[2], base[0], base[1]].map((x, i) => ({ ...x, linhaOrigem: 900 + i }));
    expect(chaves(embaralhado)).toEqual(chaves(base));
  });

  it("IMPORTAÇÃO REPETIDA do mesmo arquivo: 0 inseridos; contagem final igual (sem duplicação)", () => {
    const lote = numerarOcorrenciasQuebra(base);
    const primeira = simularGravacao("quebra_caixa", lote, []);
    expect(primeira.inseridos).toBe(4);
    const estado = lote;
    const segunda = simularGravacao("quebra_caixa", numerarOcorrenciasQuebra(base), estado);
    expect(segunda.inseridos).toBe(0);
    expect(segunda.atualizados).toBe(4);
    expect(segunda.totalFinal).toBe(4);
  });

  it("CORREÇÃO DE VALOR: a mesma ocorrência é atualizada, nenhum registro novo", () => {
    const antes = numerarOcorrenciasQuebra(base);
    const corrigido = numerarOcorrenciasQuebra(base.map((x) => (x.linhaOrigem === 56 ? { ...x, valor: 7 } : x))); // 6,50 → 7,00
    const sim = simularGravacao("quebra_caixa", corrigido, antes);
    expect(sim.inseridos).toBe(0);
    expect(sim.totalFinal).toBe(4);
    expect(total(corrigido)).toBe(total(antes) + 0.5);
  });

  it("INCLUSÃO de uma ocorrência: exatamente 1 inserido; as demais não são duplicadas", () => {
    const antes = numerarOcorrenciasQuebra(base);
    const mais = numerarOcorrenciasQuebra([...base, r("BG 07", "2026-10-04", 6.5, "OPERADORA UM", 60)]);
    const sim = simularGravacao("quebra_caixa", mais, antes);
    expect(sim.inseridos).toBe(1);
    expect(sim.totalFinal).toBe(5);
  });

  it("REMOÇÃO de uma ocorrência: a de maior número fica só no banco (o upsert nunca exclui) — total do lote cai, nada é duplicado", () => {
    const antes = numerarOcorrenciasQuebra(base);
    const menos = numerarOcorrenciasQuebra(base.filter((x) => x.linhaOrigem !== 56));
    const sim = simularGravacao("quebra_caixa", menos, antes);
    expect(sim.inseridos).toBe(0);
    expect(sim.totalFinal).toBe(4); // as 4 ocorrências anteriores seguem no banco; nenhuma é apagada pela importação
    const sobra = chavesOficiaisRepetidas(menos);
    expect(sobra).toEqual([]);
  });
});

describe("preservação das ocorrências em AMBAS as abas e totais por data/ciclo", () => {
  const cab = ["MÊS", "DATA", "LOJA", "CONFERENTE", "QUEBRA", "OPERADOR", "CPF", "MOTIVO"];
  const linha = (data: string, loja: string, valor: number, op: string, motivo = "ERRO DE DESPACHO") => ["X", new Date(`${data}T00:00:00.000Z`), loja, "C", valor, op, "", motivo];
  const aba = (linhas: unknown[][]) => [["QUEBRA DE CAIXA"], [""], [""], cab, ...linhas];
  const sheets: Record<string, unknown[][]> = {
    "QUEBRA 16-08 A 15-09": aba([
      linha("2026-08-20", "BG 01", 10, "A"), linha("2026-08-21", "BG 01", 11, "B"), linha("2026-08-22", "BG 02", 12, "C"),
      linha("2026-09-07", "BG 02", 55.3, "OPERADORA TRES", "BRINDE"), linha("2026-09-07", "BG 02", 6.5, "OPERADORA TRES", "BRINDE"), // mesma chave natural, valores diferentes
      linha("2026-09-12", "BG 02", 5.5, "OPERADORA CINCO"), linha("2026-09-12", "BG 02", 5.5, "OPERADORA CINCO"),
    ]),
    "QUEBRA 16-09 A 15-10": aba([
      linha("2026-09-16", "BG 01", 10, "A"), linha("2026-09-20", "BG 02", 11, "B"), linha("2026-10-01", "BG 03", 12, "C"),
      ...[1, 2, 3, 4, 5].map(() => linha("2026-10-04", "BG 07", 6.5, "OPERADORA UM")),
      linha("2026-09-27", "BG 07", 7, "OPERADOR DOIS"), linha("2026-09-27", "BG 07", 7, "OPERADOR DOIS"),
      linha("2026-10-16", "BG 04", 6.5, "OPERADORA SETE"), linha("2026-10-17", "BG 01", 72.5, "OPERADORA SEIS", "BRINDE SEM JUSTIFICATIVA"), linha("2026-10-18", "BG 04", 2, "OPERADOR OITO", "RETIRADA INDEVIDA"),
    ]),
  };

  it("ciclo anterior (16/08–15/09): as 3 colisões antigas viram ocorrências separadas — recupera 55,30 e o 2º 5,50", () => {
    const q = lerQuebraDaPlanilha(sheets, d("2026-09-01"));
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.aba.nomeAba).toBe("QUEBRA 16-08 A 15-09");
    expect(q.parse.registros).toHaveLength(7);
    expect(new Set(q.parse.registros.map(chaveOficialQuebra)).size).toBe(7); // nenhuma chave oficial repetida
    expect(chaveNaturalQuebra(q.parse.registros[3])).toBe(chaveNaturalQuebra(q.parse.registros[4]));
    expect(total(q.parse.registros)).toBe(10 + 11 + 12 + 55.3 + 6.5 + 5.5 + 5.5);
  });

  it("ciclo atual (16/09–15/10 + 16–18/10): as 7 linhas repetidas e os lançamentos 16–18/10 estão todos presentes", () => {
    const q = lerQuebraDaPlanilha(sheets, d("2026-10-19"));
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    const rs = q.parse.registros;
    expect(rs).toHaveLength(13);
    expect(rs.filter((x) => x.extras.operador === "OPERADORA UM").map((x) => x.extras.ocorrencia)).toEqual(["1", "2", "3", "4", "5"]);
    expect(rs.filter((x) => x.extras.operador === "OPERADOR DOIS").map((x) => x.extras.ocorrencia)).toEqual(["1", "2"]);
    expect(rs.filter((x) => ["2026-10-16", "2026-10-17", "2026-10-18"].includes(x.data.toISOString().slice(0, 10)))).toHaveLength(3);
    expect(total(rs)).toBe(10 + 11 + 12 + 5 * 6.5 + 14 + 6.5 + 72.5 + 2);
  });

  it("totais por data do lote = soma das linhas da planilha em cada data (inclusive datas repetidas)", () => {
    const q = lerQuebraDaPlanilha(sheets, d("2026-10-19"));
    if (!q.ok) throw new Error("esperava ok");
    const porData = new Map<string, number>();
    for (const x of q.parse.registros) porData.set(x.data.toISOString().slice(0, 10), Math.round(((porData.get(x.data.toISOString().slice(0, 10)) ?? 0) + x.valor) * 100) / 100);
    expect(porData.get("2026-10-04")).toBe(32.5);
    expect(porData.get("2026-09-27")).toBe(14);
    expect(porData.get("2026-10-17")).toBe(72.5);
  });
});
