import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { montarPeriodoCompraDireta } from "@/lib/services/compraDiretaPainel";
import { ROTULO_AJUSTE_SEM_SAIDA } from "@/lib/services/compraDiretaPainel";

/**
 * REGRA DE DATA INEGOCIÁVEL: o período selecionado no filtro é o período efetivamente consultado (início e fim
 * inclusive). Nenhum serviço dos indicadores pode deslocar datas (D-1).
 */
const ler = (caminho: string) => readFileSync(caminho, "utf-8");

const SERVICOS_LITERAIS = [
  "lib/services/brindesPainel.server.ts",
  "lib/services/cancelamentoPainel.server.ts",
  "lib/services/compraDiretaPainel.server.ts",
  "lib/services/indicadores.server.ts",
  "lib/services/retiradaDeposito.server.ts",
  "lib/services/analiseGerencial.server.ts",
  "lib/services/fechamentoSemanal.server.ts",
  "lib/services/visaoGeral.ts",
  "lib/services/controlesCaixa.ts",
  "lib/services/fechamentoSemanal.ts",
  "lib/services/cancelamentoMadrugada.server.ts",
];

describe("data literal — sem deslocamento D-1", () => {
  it.each(SERVICOS_LITERAIS)("%s não usa dataDMenos1/janelaD1", (arquivo) => {
    expect(ler(arquivo)).not.toMatch(/dataDMenos1|janelaD1/);
  });

  it.each(SERVICOS_LITERAIS)("%s não usa dataDMenos2/janelaD2 (sem D-2) e lib/rules/datas.ts não exporta deslocamentos", (arquivo) => {
    expect(ler(arquivo)).not.toMatch(/dataDMenos2|janelaD2/);
    expect(ler("lib/rules/datas.ts")).not.toMatch(/dataDMenos/);
  });

  it("o alerta de madrugada filtra pela data oficial do registro (data_calendario), não pela data operacional", () => {
    const fonte = ler("lib/services/cancelamentoMadrugada.server.ts");
    expect(fonte).toMatch(/between\(tab\.dataCalendario, inicioOcorrencia, fimOcorrencia\)/);
    expect(fonte).not.toMatch(/between\(tab\.dataOperacional/);
  });

  it("Quebra de Caixa (ciclo): filtra pela data real do lançamento, não pela aba/fonte de origem", () => {
    const fonte = ler("lib/services/controlesCaixa.ts");
    const trecho = fonte.slice(fonte.indexOf("export async function buscarQuebraCaixaDoPeriodo"), fonte.indexOf("Quebra de Caixa — período PERSONALIZADO"));
    expect(trecho).toMatch(/between\(quebraCaixa\.data,/);
    expect(trecho).not.toMatch(/fontePeriodoId|fontesPorPeriodo/);
  });

  it("os painéis consultam exatamente [início, fim] escolhidos", () => {
    for (const f of ["brindesPainel", "cancelamentoPainel", "compraDiretaPainel"]) {
      const fonte = ler(`lib/services/${f}.server.ts`);
      expect(fonte).toMatch(/const inicioJanela = referenciaInicio;/);
      expect(fonte).toMatch(/const fimJanela = referenciaFim;/);
    }
  });

  it("Compra Direta: período 01/10–10/10 soma só 01/10..10/10 e mantém Nota Fiscal fora da retirada real", () => {
    const p = montarPeriodoCompraDireta(
      "2026-10-01",
      "2026-10-10",
      [
        { codigo: "BG 01", data: "2026-10-01", valor: 1000 },
        { codigo: "BG 01", data: "2026-10-10", valor: 1000 },
      ],
      [
        { codigo: "BG 01", data: "2026-10-01", motivo: "FIXAS", valor: 10 },
        { codigo: "BG 01", data: "2026-10-10", motivo: "FIXAS", valor: 20 },
        { codigo: "BG 01", data: "2026-10-05", motivo: "NOTA FISCAL", valor: 99 },
      ]
    );
    expect(p.inicioOcorrencia).toBe("2026-10-01");
    expect(p.fimOcorrencia).toBe("2026-10-10");
    expect(p.valor).toBe(30); // retirada real: só FIXAS
    expect(p.ajustesSemSaida).toBe(99); // NOTA FISCAL separada
    expect(p.totalLancado).toBe(129);
    expect(ROTULO_AJUSTE_SEM_SAIDA).toMatch(/sem saída de caixa/);
  });
});
