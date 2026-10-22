import { describe, expect, it } from "vitest";
import { alinharOcorrenciasComExistentes, chaveNaturalQuebra, chaveOficialQuebra, chavesOficiaisRepetidas, numerarOcorrenciasQuebra, type OcorrenciaExistente } from "@/lib/import/ocorrenciaQuebra";
import type { RegistroBase } from "@/lib/import/tipos";

/**
 * ESTABILIDADE da identidade das ocorrências quando um valor é corrigido. A numeração "por valor crescente" sozinha pode TROCAR
 * valores entre ocorrências do mesmo grupo (identidade); o alinhamento com o banco preserva a identidade. Dados fictícios.
 */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const r = (valor: number, linhaOrigem: number, operador = "OPERADORA UM", data = "2026-10-04", motivo = "ERRO DE DESPACHO"): RegistroBase => ({
  unidade: "BG 07", data: d(data), valor, linhaOrigem, extras: { conferente: "MONALISA", operador, cpf: "111", motivo },
});
const NAT = chaveNaturalQuebra(r(0, 0));
/** Estado do banco: ocorrência → valor (todas da mesma chave natural). */
const banco = (valores: number[]): OcorrenciaExistente[] => valores.map((v, i) => ({ chaveNatural: NAT, ocorrencia: i + 1, valor: v }));
const mapa = (rs: RegistroBase[]) => Object.fromEntries(rs.map((x) => [x.extras.ocorrencia, x.valor]));
/** nº de ocorrências cujo valor mudaria em relação ao banco (= UPDATEs), e quantas seriam inseridas */
const diff = (estado: OcorrenciaExistente[], lote: RegistroBase[]) => {
  const atual = new Map(estado.map((e) => [e.ocorrencia, e.valor]));
  let updates = 0, inserts = 0;
  for (const x of lote) { const v = atual.get(Number(x.extras.ocorrencia)); if (v === undefined) inserts++; else if (Math.round(v * 100) !== Math.round(x.valor * 100)) updates++; }
  return { updates, inserts };
};

describe("RISCO DEMONSTRADO: numeração só por valor crescente troca a identidade ao corrigir um valor", () => {
  const estado = banco([6.5, 6.5, 9]); // ocorr. 1, 2, 3 já gravadas
  const corrigido = [r(6.5, 1), r(6.5, 2), r(5, 3)]; // a de R$ 9,00 foi corrigida para R$ 5,00

  it("só por valor crescente: 2 UPDATEs (a ocorrência 1 vira 5,00 e a 3 vira 6,50) — os totais ficam certos, mas a identidade das linhas trocou", () => {
    const naive = numerarOcorrenciasQuebra(corrigido);
    expect(mapa(naive)).toEqual({ 1: 5, 2: 6.5, 3: 6.5 });
    expect(diff(estado, naive)).toEqual({ updates: 2, inserts: 0 });
    expect(naive.reduce((a, x) => a + x.valor, 0)).toBeCloseTo(18, 5); // total correto
  });

  it("com ALINHAMENTO ao banco: 1 UPDATE só (a MESMA ocorrência 3 de R$ 9,00 passa a R$ 5,00); as ocorrências 1 e 2 não mudam", () => {
    const alinhado = alinharOcorrenciasComExistentes(corrigido, estado);
    expect(mapa(alinhado)).toEqual({ 1: 6.5, 2: 6.5, 3: 5 });
    expect(diff(estado, alinhado)).toEqual({ updates: 1, inserts: 0 });
    expect(chavesOficiaisRepetidas(alinhado)).toEqual([]);
  });
});

describe("alinharOcorrenciasComExistentes — casos", () => {
  it("sem estado existente: numeração padrão (valor crescente)", () => {
    expect(mapa(alinharOcorrenciasComExistentes([r(9, 1), r(6.5, 2), r(6.5, 3)], []))).toEqual({ 1: 6.5, 2: 6.5, 3: 9 });
  });
  it("mesmo arquivo reimportado: 0 updates, 0 inserts, qualquer ordem de linhas", () => {
    const estado = banco([6.5, 6.5, 9]);
    const lote = alinharOcorrenciasComExistentes([r(9, 70), r(6.5, 10), r(6.5, 5)], estado);
    expect(diff(estado, lote)).toEqual({ updates: 0, inserts: 0 });
  });
  it("correção para CIMA (6,50 → 12,00 na do meio): 1 update, identidade preservada", () => {
    const estado = banco([6.5, 6.5, 9]);
    const lote = alinharOcorrenciasComExistentes([r(6.5, 1), r(12, 2), r(9, 3)], estado);
    expect(diff(estado, lote)).toEqual({ updates: 1, inserts: 0 });
    expect(mapa(lote)).toEqual({ 1: 6.5, 2: 12, 3: 9 }); // a ocorrência 2 (a 6,50) virou 12,00; a de 9,00 continua sendo a 3
  });
  it("inclusão de uma ocorrência (qualquer valor): exatamente 1 insert, nenhum update", () => {
    const estado = banco([6.5, 6.5, 9]);
    const lote = alinharOcorrenciasComExistentes([r(6.5, 1), r(7, 2), r(6.5, 3), r(9, 4)], estado);
    expect(diff(estado, lote)).toEqual({ updates: 0, inserts: 1 });
    expect(lote.find((x) => x.valor === 7)!.extras.ocorrencia).toBe("4");
  });
  it("remoção de uma ocorrência: as demais não mudam; a removida fica só no banco (nada é excluído)", () => {
    const estado = banco([6.5, 6.5, 9]);
    const lote = alinharOcorrenciasComExistentes([r(6.5, 1), r(9, 2)], estado);
    expect(diff(estado, lote)).toEqual({ updates: 0, inserts: 0 });
    expect(mapa(lote)).toEqual({ 1: 6.5, 3: 9 }); // a ocorrência 2 (6,50) não aparece no lote → fica intacta no banco
  });
  it("correção + inclusão no mesmo grupo: o excedente ganha número novo (maior existente + 1)", () => {
    const estado = banco([6.5, 9]);
    const lote = alinharOcorrenciasComExistentes([r(6.5, 1), r(10, 2), r(3, 3)], estado); // 9→10 e uma nova de 3,00
    expect(diff(estado, lote).inserts).toBe(1);
    expect(new Set(lote.map(chaveOficialQuebra)).size).toBe(3);
  });
  it("caso REAL do histórico: banco tem a ocorrência 1 = R$ 32,46 (a última vencia); a planilha tem 2,00 e 32,46 → 0 updates, 1 insert (a de 2,00)", () => {
    const estado = banco([32.46]);
    const lote = alinharOcorrenciasComExistentes([r(2, 47), r(32.46, 50)], estado);
    expect(diff(estado, lote)).toEqual({ updates: 0, inserts: 1 });
    expect(mapa(lote)).toEqual({ 1: 32.46, 2: 2 });
  });
  it("grupos diferentes (outro operador/dia) são independentes", () => {
    const outro = r(6.5, 9, "OUTRO");
    const lote = alinharOcorrenciasComExistentes([r(6.5, 1), outro], banco([6.5]));
    expect(lote.find((x) => x.extras.operador === "OUTRO")!.extras.ocorrencia).toBe("1");
  });
});

describe("propriedades (aleatório, determinístico): nenhuma perda, nenhuma duplicidade, ≤ 1 update por correção", () => {
  // gerador pseudoaleatório simples (semente fixa)
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  it("500 cenários: corrigir 1 valor → ≤ 1 update, 0 inserts; chaves únicas; total do lote = soma do arquivo", () => {
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rnd() * 6);
      const valores = Array.from({ length: n }, () => Math.round((1 + rnd() * 3) * 2) / 2); // poucos valores distintos → muitos empates
      const estado = banco([...valores].sort((a, b) => a - b));
      const idx = Math.floor(rnd() * n);
      const novo = Math.round((1 + rnd() * 20) * 100) / 100;
      const arquivo = valores.map((v, k) => r(k === idx ? novo : v, k + 1));
      const lote = alinharOcorrenciasComExistentes(arquivo, estado);
      const df = diff(estado, lote);
      expect(df.inserts).toBe(0);
      expect(df.updates).toBeLessThanOrEqual(1);
      expect(chavesOficiaisRepetidas(lote)).toEqual([]);
      expect(lote.reduce((a, x) => a + x.valor, 0)).toBeCloseTo(arquivo.reduce((a, x) => a + x.valor, 0), 6);
    }
  });
  it("500 cenários: embaralhar linhas e reimportar → 0 updates, 0 inserts", () => {
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rnd() * 6);
      const valores = Array.from({ length: n }, () => Math.round((1 + rnd() * 3) * 2) / 2);
      const estado = banco([...valores].sort((a, b) => a - b));
      const arquivo = valores.map((v, k) => r(v, 1000 - k)).sort(() => rnd() - 0.5);
      expect(diff(estado, alinharOcorrenciasComExistentes(arquivo, estado))).toEqual({ updates: 0, inserts: 0 });
    }
  });
});
