import { describe, expect, it } from "vitest";
import { parsePdvMaquininha } from "@/lib/import/parsers/pdvMaquininha";
import { conferirGravacaoPdv, conferirLotePdv, localizarColunaFormaPdv, validarCabecalhoPdv, chavePdv } from "@/lib/import/conferenciaPdv";
import { BASE_REGISTRY, validarColunas } from "@/lib/services/atualizacaoBases";
import type { RegistroBase } from "@/lib/import/tipos";

const ANTIGO = ["Loja", "Data", "Forma de Pag.", "Venda (PDV - Cloud)", "Total Maq. ( Adquirente - Sicredi)", "Diferença"];
const NOVO = ["Loja", "Data", "Tipo_Pagamento", "Venda (PDV - Cloud)", "Total Maq. ( Adquirente - Sicredi)", "Diferença"];
const linhas = [
  ["BG 02", "31/08/2026", "Débito", 3309.19, 3469.39, 160.2],
  ["BG 02", "31/08/2026", "Pix", 1000, 900, -100],
  ["BG 02", "31/08/2026", "Crédito", 500, 500, 0],
  ["BG 01", "31/08/2026", "Pix", 200, null, -200], // Maquininha em branco
];

describe("cabeçalho do PDV × Maquininha: layout antigo e novo", () => {
  it("aceita 'Forma de Pag.' (antigo) e 'Tipo_Pagamento' (novo); nenhum prejudica o outro", () => {
    expect(validarCabecalhoPdv(ANTIGO)).toEqual({ ok: true, faltando: [], layoutForma: "antigo" });
    expect(validarCabecalhoPdv(NOVO)).toEqual({ ok: true, faltando: [], layoutForma: "novo" });
    expect(localizarColunaFormaPdv(ANTIGO)).toBe(2);
    expect(localizarColunaFormaPdv(NOVO)).toBe(2);
    expect(localizarColunaFormaPdv(["Loja", "Data", "Tipo Pagamento"])).toBe(2);
  });

  it("o parser lê a forma nos dois layouts e devolve os MESMOS registros", () => {
    const a = parsePdvMaquininha(ANTIGO, linhas);
    const n = parsePdvMaquininha(NOVO, linhas);
    expect(n.registros.length).toBe(4);
    expect(n.registros.map((r) => r.extras.forma_pagamento)).toEqual(["Débito", "Pix", "Crédito", "Pix"]);
    expect(n.registros).toEqual(a.registros);
  });

  it("coluna obrigatória ausente → NADA é lido e o motivo aparece (nunca forma vazia silenciosa)", () => {
    const semForma = ["Loja", "Data", "Outra coisa", "Venda (PDV - Cloud)", "Total Maq. ( Adquirente - Sicredi)", "Diferença"];
    const r = parsePdvMaquininha(semForma, linhas);
    expect(r.registros).toEqual([]);
    expect(r.rejeitados[0].motivo).toMatch(/Forma de Pag\. \(ou Tipo_Pagamento\)/);
    expect(validarCabecalhoPdv(semForma).faltando).toEqual(["Forma de Pag. (ou Tipo_Pagamento)"]);
    const semMaq = ["Loja", "Data", "Tipo_Pagamento", "Venda (PDV - Cloud)", "Diferença"];
    expect(parsePdvMaquininha(semMaq, linhas).registros).toEqual([]);
    expect(validarCabecalhoPdv(semMaq).faltando).toEqual(["Total Maq."]);
  });

  it("a validação da tela (BASE_REGISTRY) também aceita os dois nomes e recusa a ausência", () => {
    const cols = BASE_REGISTRY.find((b) => b.id === "pdvMaquininha")!.colunasObrigatorias!;
    expect(validarColunas(ANTIGO, cols)).toEqual([]);
    expect(validarColunas(NOVO, cols)).toEqual([]);
    expect(validarColunas(["Loja", "Data", "Venda", "Total Maq", "Diferença"], cols)).toEqual(["Forma de Pag. (ou Tipo_Pagamento)"]);
  });
});

describe("conferência do lote ANTES de gravar", () => {
  it("lote correto: sem colisão, totais e por forma; Maquininha em branco só é contada", () => {
    const lote = parsePdvMaquininha(NOVO, linhas).registros;
    const c = conferirLotePdv(lote, 1);
    expect(c.bloqueios).toEqual([]);
    expect([c.linhas, c.chavesUnicas, c.colisoes, c.formasVazias]).toEqual([4, 4, 0, 0]);
    expect(c.totalPdv).toBe(5009.19);
    expect(c.totalMaquininha).toBe(4869.39);
    expect(c.diferenca).toBe(-139.8); // Maquininha − PDV
    expect(c.maquininhaEmBranco).toBe(1);
    expect(c.periodo).toEqual({ inicio: "2026-08-31", fim: "2026-08-31" });
    expect(c.porForma.map((f) => f.forma)).toEqual(["Crédito", "Débito", "Pix"]);
  });

  it("o incidente de 08/10: forma vazia em todas as linhas → colapsa 4 linhas em 1 e a gravação é BLOQUEADA", () => {
    const vazias: RegistroBase[] = parsePdvMaquininha(NOVO, linhas).registros.map((r) => ({ ...r, unidade: "BG 02", extras: { ...r.extras, forma_pagamento: "" } }));
    const c = conferirLotePdv(vazias);
    expect(c.formasVazias).toBe(4);
    expect(c.chavesUnicas).toBe(1);
    expect(c.colisoes).toBe(1);
    expect(c.bloqueios.length).toBe(2);
    expect(c.bloqueios.join(" ")).toMatch(/forma de pagamento vazia/);
    expect(c.bloqueios.join(" ")).toMatch(/perderia valores/);
  });

  it("chave repetida (mesma loja+data+forma em duas linhas) bloqueia; lote vazio bloqueia", () => {
    const dup = [...parsePdvMaquininha(NOVO, linhas).registros];
    dup.push({ ...dup[0] });
    expect(conferirLotePdv(dup).colisoes).toBe(1);
    expect(conferirLotePdv(dup).bloqueios.length).toBe(1);
    expect(conferirLotePdv([]).bloqueios[0]).toMatch(/nenhuma linha válida/);
  });
});

describe("conferência DEPOIS de gravar", () => {
  const lote = parsePdvMaquininha(NOVO, linhas).registros;
  const bancoIgual = lote.map((r) => ({ chave: chavePdv(r), pdv: r.valor, maquininha: Number(r.extras.valorMaquininha) }));

  it("banco igual ao lote → ok, mesmas contagens e totais (outras chaves do banco são ignoradas)", () => {
    const r = conferirGravacaoPdv(lote, [...bancoIgual, { chave: "BG 99|2026-01-01|Pix", pdv: 1, maquininha: 1 }]);
    expect(r.ok).toBe(true);
    expect([r.esperadas, r.encontradas]).toEqual([4, 4]);
    expect(r.totalBanco).toEqual(r.totalLote);
  });

  it("chave ausente ou com valor diferente → não ok, e diz qual", () => {
    const faltando = conferirGravacaoPdv(lote, bancoIgual.slice(1));
    expect(faltando.ok).toBe(false);
    expect(faltando.ausentes).toEqual([bancoIgual[0].chave]);
    const alterado = conferirGravacaoPdv(lote, bancoIgual.map((b, i) => (i === 1 ? { ...b, maquininha: b.maquininha + 10 } : b)));
    expect(alterado.ok).toBe(false);
    expect(alterado.divergentes.map((d) => d.chave)).toEqual([bancoIgual[1].chave]);
  });
});
