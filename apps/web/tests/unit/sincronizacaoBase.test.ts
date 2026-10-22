import { describe, expect, it } from "vitest";
import {
  BASES_SNAPSHOT,
  CONFIG_SINCRONIZACAO,
  escopoDaFonte,
  planejarSincronizacaoBase,
  type LinhaBanco,
  type LinhaFonte,
} from "@/lib/import/sincronizacaoBase";

const f = (unidade: string, data: string, chave: string[], valor: number): LinhaFonte => ({ unidade, data, chave, centavos: Math.round(valor * 100) });
let seq = 0;
const b = (unidade: string, data: string, chave: string[], valor: number, id?: string): LinhaBanco => ({ ...f(unidade, data, chave, valor), id: id ?? `id-${++seq}` });

describe("planejarSincronizacaoBase — classificação", () => {
  it("separa novos, iguais, alterados e só-no-banco; o histórico fora do intervalo/lojas não entra", () => {
    const fonte = [f("BG 01", "2026-10-01", ["OPEX"], 10), f("BG 01", "2026-10-02", ["OPEX"], 20), f("BG 01", "2026-10-03", ["CMV"], 5)];
    const banco = [
      b("BG 01", "2026-10-01", ["OPEX"], 10, "a"), // igual
      b("BG 01", "2026-10-02", ["OPEX"], 99, "b"), // alterado
      b("BG 01", "2026-10-03", ["FIXAS"], 5, "c"), // só no banco
      b("BG 01", "2026-09-30", ["OPEX"], 7, "hist"), // fora do intervalo
    ];
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco });
    expect(p.iguais).toBe(1);
    expect(p.alterados.map((x) => x.id)).toEqual(["b"]);
    expect(p.novos.map((x) => x.chave[0])).toEqual(["CMV"]);
    expect(p.removiveis.map((x) => x.id)).toEqual(["c"]);
    expect(p.idsParaRemover).toEqual(["c"]);
    expect(p.escopo).toEqual({ unidades: ["BG 01"], inicio: "2026-10-01", fim: "2026-10-03" });
    expect(p.totalFinalNoEscopoCentavos).toBe(3500);
  });

  it("coincidência de loja+dia+valor é só pista: aparece como candidata, nunca como prova nem muda o plano", () => {
    const fonte = [f("BG 01", "2026-10-01", ["OPEX"], 10)];
    const banco = [b("BG 01", "2026-10-01", ["FIXAS"], 10, "x")];
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco });
    expect(p.removiveis[0].candidatasNoMesmoDia).toEqual([{ chave: ["OPEX"], centavos: 1000, mesmoValor: true }]);
    expect(p.removiveisComCoincidenciaDeValor).toBe(1);
    expect(p.idsParaRemover).toEqual(["x"]); // continua sendo uma exclusão a aprovar por ID
  });

  it("separa dias em que o total do banco bate com o da fonte dos dias em que o conteúdo mudou", () => {
    const fonte = [f("BG 01", "2026-10-01", ["B"], 10), f("BG 01", "2026-10-02", ["B"], 5)];
    const banco = [b("BG 01", "2026-10-01", ["A"], 10), b("BG 01", "2026-10-02", ["A"], 30)];
    const p = planejarSincronizacaoBase({ base: "brindes", fonte: fonte.map((l) => ({ ...l, chave: [l.chave[0], ""] })), banco: banco.map((l) => ({ ...l, chave: [l.chave[0], ""] })) });
    expect(p.totaisDoDia.iguais).toBe(1);
    expect(p.totaisDoDia.diferentes).toBe(1);
    expect(p.totaisDoDia.centavosRemoviveisEmDiasIguais).toBe(1000);
    expect(p.totaisDoDia.centavosRemoviveisEmDiasDiferentes).toBe(3000);
  });

  it("agrega linhas de mesma chave (soma) e é idempotente: reaplicar o plano final não gera mudanças", () => {
    const fonte = [f("BG 01", "2026-10-01", ["OPEX"], 4), f("BG 01", "2026-10-01", ["OPEX"], 6)];
    const p1 = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco: [] });
    expect(p1.fonte.chaves).toBe(1);
    expect(p1.novos[0].centavos).toBe(1000);
    const estadoFinal = p1.novos.map((l, i) => ({ ...l, id: `n${i}` }));
    const p2 = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco: estadoFinal });
    expect([p2.novos.length, p2.alterados.length, p2.removiveis.length, p2.iguais]).toEqual([0, 0, 0, 1]);
  });
});

describe("planejarSincronizacaoBase — riscos e bloqueios", () => {
  it("loja ausente do arquivo NUNCA autoriza exclusão: a loja é preservada e a exclusão fica bloqueada", () => {
    const fonte = [f("BG 01", "2026-10-01", ["OPEX"], 10)];
    const banco = [b("BG 01", "2026-10-01", ["FIXAS"], 10, "velho"), b("BG 02", "2026-10-01", ["OPEX"], 50, "outra-loja")];
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco });
    expect(p.riscos.map((r) => r.codigo)).toContain("LOJA_AUSENTE_NO_ARQUIVO");
    expect(p.exclusoesPermitidas).toBe(false);
    expect(p.idsParaRemover).toEqual([]);
    expect(p.removiveis.map((r) => r.id)).toEqual(["velho"]); // BG 02 nem aparece como removível
    expect(p.podeGravar).toBe(false); // sem --sem-exclusao não há como alcançar o snapshot
  });

  it("com semExclusao a gravação segue sem excluir nada e o total esperado preserva os antigos", () => {
    const fonte = [f("BG 01", "2026-10-01", ["OPEX"], 10)];
    const banco = [b("BG 01", "2026-10-01", ["FIXAS"], 10, "velho")];
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco, opcoes: { semExclusao: true } });
    expect(p.idsParaRemover).toEqual([]);
    expect(p.podeGravar).toBe(true);
    expect(p.totalFinalNoEscopoCentavos).toBe(2000);
  });

  it("dia sem nenhuma linha na fonte exige confirmação explícita; confirmado, a exclusão é liberada", () => {
    const fonte = [f("BG 01", "2026-10-01", ["OPEX"], 10), f("BG 01", "2026-10-03", ["OPEX"], 10)];
    const banco = [b("BG 01", "2026-10-02", ["OPEX"], 5, "dia-vazio")];
    const sem = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco });
    expect(sem.riscos.find((r) => r.codigo === "DIAS_SEM_MOVIMENTO")?.gravidade).toBe("requer-confirmacao");
    expect(sem.idsParaRemover).toEqual([]);
    const com = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco, opcoes: { confirmarDiasSemMovimento: true } });
    expect(com.idsParaRemover).toEqual(["dia-vazio"]);
    expect(com.hashPlano).not.toBe(sem.hashPlano);
  });

  it("fonte vazia e bloqueios externos (rejeições) bloqueiam tudo", () => {
    expect(planejarSincronizacaoBase({ base: "brindes", fonte: [], banco: [b("BG 01", "2026-10-01", ["A", ""], 1)] }).podeGravar).toBe(false);
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte: [f("BG 01", "2026-10-01", ["OPEX"], 1)], banco: [], opcoes: { bloqueiosExternos: ["2 rejeições com dado real"] } });
    expect(p.podeGravar).toBe(false);
    expect(p.riscos[0].gravidade).toBe("bloqueia-tudo");
  });

  it("Retirada Depósito: chave duplicada na fonte (última vence) bloqueia a exclusão", () => {
    const k = ["CX1", "DEPOSITO", "", "u", "a"];
    const fonte = [f("BG 01", "2026-10-01", k, 10), f("BG 01", "2026-10-01", k, 12)];
    const p = planejarSincronizacaoBase({ base: "retiradaDeposito", fonte, banco: [b("BG 01", "2026-10-01", ["CX2", "DEPOSITO", "", "u", "a"], 3, "x")] });
    expect(p.riscos.map((r) => r.codigo)).toContain("DUPLICIDADE_NA_FONTE");
    expect(p.fonte.chaves).toBe(1);
    expect(p.novos[0].centavos).toBe(1200); // última linha vence, como no importador atual
    expect(p.idsParaRemover).toEqual([]);
  });

  it("limites configuráveis só valem quando informados (sem limite padrão) e bloqueiam a exclusão ao serem excedidos", () => {
    const fonte = [f("BG 01", "2026-10-01", ["OPEX"], 10)];
    const banco = [b("BG 01", "2026-10-01", ["A"], 3, "1"), b("BG 01", "2026-10-01", ["B"], 4, "2")];
    expect(planejarSincronizacaoBase({ base: "compraDireta", fonte, banco }).idsParaRemover).toHaveLength(2);
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco, opcoes: { limites: { maxRemocoes: 1 } } });
    expect(p.riscos.find((r) => r.codigo === "LIMITE_EXCEDIDO")).toBeTruthy();
    expect(p.idsParaRemover).toEqual([]);
    const pPerc = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco, opcoes: { limites: { maxRemocaoPercentual: 10 } } });
    expect(pPerc.riscos.map((r) => r.codigo)).toContain("LIMITE_EXCEDIDO");
    const pValor = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco, opcoes: { limites: { maxValorRemovidoCentavos: 100 } } });
    expect(pValor.riscos.map((r) => r.codigo)).toContain("LIMITE_EXCEDIDO");
  });

  it("avisos informativos: valores alterados e último dia possivelmente parcial", () => {
    const fonte = [f("BG 01", "2026-10-01", ["X"], 1), f("BG 02", "2026-10-01", ["X"], 1), f("BG 01", "2026-10-02", ["X"], 1)];
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco: [b("BG 01", "2026-10-01", ["X"], 9)] });
    expect(p.riscos.map((r) => r.codigo)).toEqual(expect.arrayContaining(["ALTERACOES_DE_VALOR", "ULTIMO_DIA_POSSIVELMENTE_PARCIAL"]));
    expect(p.podeGravar).toBe(true);
  });
});

describe("o plano diz se o banco ESPELHA a planilha depois de aplicar", () => {
  const fonte = [f("BG 01", "2026-10-01", ["OPEX"], 10)];
  const velho = b("BG 01", "2026-10-01", ["FIXAS"], 4, "velho");
  it("sem registros só no banco: espelha, nada sobra", () => {
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco: [b("BG 01", "2026-10-01", ["OPEX"], 10, "a")] });
    expect([p.espelhaPlanilhaAposAplicar, p.sobraAposAplicarCentavos]).toEqual([true, 0]);
    expect(p.riscos.map((r) => r.codigo)).not.toContain("NAO_ESPELHA_A_PLANILHA");
  });
  it("com exclusão autorizada pelo plano: espelha (o total final é o da planilha)", () => {
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco: [velho] });
    expect([p.espelhaPlanilhaAposAplicar, p.sobraAposAplicarCentavos, p.totalFinalNoEscopoCentavos]).toEqual([true, 0, 1000]);
  });
  it("com semExclusao: NÃO espelha; a sobra é exatamente o que a planilha não tem e há um aviso explícito", () => {
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco: [velho], opcoes: { semExclusao: true } });
    expect([p.espelhaPlanilhaAposAplicar, p.sobraAposAplicarCentavos, p.totalFinalNoEscopoCentavos]).toEqual([false, 400, 1400]);
    const aviso = p.riscos.find((r) => r.codigo === "NAO_ESPELHA_A_PLANILHA");
    expect(aviso?.gravidade).toBe("aviso");
    expect(aviso?.descricao).toMatch(/NÃO baterão com a planilha/);
    expect(p.podeGravar).toBe(true); // é só um aviso: gravar novos/alterados continua permitido
  });
  it("com exclusão BLOQUEADA por risco (loja ausente): NÃO espelha e avisa", () => {
    const p = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco: [velho, b("BG 02", "2026-10-01", ["X"], 1, "outra")] });
    expect(p.espelhaPlanilhaAposAplicar).toBe(false);
    expect(p.riscos.map((r) => r.codigo)).toContain("NAO_ESPELHA_A_PLANILHA");
  });
  it("renomear motivo/submotivo (mesmo valor) = chave antiga some + chave nova entra: com exclusão o total não acumula", () => {
    const fonteBrindes = [f("BG 01", "2026-10-01", ["BRINDE PRESENTE", "DESCONTO VENCIMENTO"], 10)];
    const bancoBrindes = [b("BG 01", "2026-10-01", ["BRINDE PRESENTE", "DESCONTO"], 10, "antigo")];
    const p = planejarSincronizacaoBase({ base: "brindes", fonte: fonteBrindes, banco: bancoBrindes });
    expect([p.novos.length, p.removiveis.length, p.totalFinalNoEscopoCentavos, p.espelhaPlanilhaAposAplicar]).toEqual([1, 1, 1000, true]);
    const sem = planejarSincronizacaoBase({ base: "brindes", fonte: fonteBrindes, banco: bancoBrindes, opcoes: { semExclusao: true } });
    expect(sem.totalFinalNoEscopoCentavos).toBe(2000); // sem excluir, o valor aparece em DOBRO
  });
});

describe("hash do plano", () => {
  const fonte = [f("BG 01", "2026-10-01", ["OPEX"], 10)];
  const banco = [b("BG 01", "2026-10-01", ["FIXAS"], 10, "zz")];
  it("é estável para a mesma entrada e muda com o arquivo, o banco, as opções ou os IDs", () => {
    const base = planejarSincronizacaoBase({ base: "compraDireta", fonte, banco, opcoes: { arquivoSha256: "aaa" } });
    expect(planejarSincronizacaoBase({ base: "compraDireta", fonte, banco, opcoes: { arquivoSha256: "aaa" } }).hashPlano).toBe(base.hashPlano);
    expect(planejarSincronizacaoBase({ base: "compraDireta", fonte, banco, opcoes: { arquivoSha256: "bbb" } }).hashPlano).not.toBe(base.hashPlano);
    expect(planejarSincronizacaoBase({ base: "compraDireta", fonte, banco: [{ ...banco[0], centavos: 1001 }], opcoes: { arquivoSha256: "aaa" } }).hashPlano).not.toBe(base.hashPlano);
    expect(planejarSincronizacaoBase({ base: "compraDireta", fonte, banco: [{ ...banco[0], id: "outro" }], opcoes: { arquivoSha256: "aaa" } }).hashPlano).not.toBe(base.hashPlano);
    expect(planejarSincronizacaoBase({ base: "compraDireta", fonte, banco, opcoes: { arquivoSha256: "aaa", semExclusao: true } }).hashPlano).not.toBe(base.hashPlano);
  });
});

describe("configuração", () => {
  it("cobre as 6 tabelas autoritativas aprovadas e a chave de cada uma", () => {
    expect([...BASES_SNAPSHOT].sort()).toEqual(["brindes", "cancelamentoDelivery", "cancelamentoSalao", "compraDireta", "faturamento", "retiradaDeposito"]);
    expect(CONFIG_SINCRONIZACAO.brindes.camposChave).toEqual(["motivo", "motivo2"]);
    expect(CONFIG_SINCRONIZACAO.faturamento.camposChave).toEqual([]);
    expect(CONFIG_SINCRONIZACAO.retiradaDeposito.camposChave).toHaveLength(5);
  });
  it("escopoDaFonte usa só as lojas e datas presentes no arquivo", () => {
    expect(escopoDaFonte([f("BG 02", "2026-10-05", [], 1), f("BG 01", "2026-10-01", [], 1)])).toEqual({ unidades: ["BG 01", "BG 02"], inicio: "2026-10-01", fim: "2026-10-05" });
    expect(escopoDaFonte([])).toBeNull();
  });
});
