import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TABELAS_PADRAO, destinoPadrao, gerarBackup, verificarBackup, type FonteBackup } from "../../scripts/backup-pre-gravacao";

/** Backup verificável pré-gravação — testes com uma fonte FALSA (nenhum banco real é consultado nem alterado). */
const dirs: string[] = [];
const novoDir = () => { const d = mkdtempSync(join(tmpdir(), "bkp-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const fonteFalsa = (dados: Record<string, { linhas: Record<string, unknown>[]; contagem?: number; soma?: string | null }>): FonteBackup => ({
  async lerTabela(t) {
    const d = dados[t] ?? { linhas: [] };
    return { linhas: d.linhas, contagem: d.contagem ?? d.linhas.length, somaValor: d.soma ?? null };
  },
});
const DADOS = {
  brindes: { linhas: [{ id: "1", valor: "10.50", motivo: "A" }, { id: "2", valor: "5.00", motivo: "B" }], soma: "15.50" },
  troco: { linhas: [{ id: "9", caixa: "PDV 01" }] },
  vazia: { linhas: [] },
};

describe("gerarBackup", () => {
  it("grava um .jsonl por tabela + MANIFESTO com SHA-256, linhas e soma, e confere arquivo × banco", async () => {
    const dir = join(novoDir(), "b1");
    const r = await gerarBackup(fonteFalsa(DADOS), { destino: dir, tabelas: ["brindes", "troco"] });
    expect(r.ok).toBe(true);
    expect(r.manifesto.tabelas.brindes).toMatchObject({ linhasNoArquivo: 2, linhasNoBanco: 2, somaValor: "15.50", conferido: true });
    expect(r.manifesto.tabelas.brindes.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(dir, "brindes.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l).id)).toEqual(["1", "2"]);
    expect(existsSync(join(dir, "MANIFESTO.json"))).toBe(true);
  });

  it("marca DIVERGENTE quando a contagem do banco não bate com o que foi lido", async () => {
    const dir = join(novoDir(), "b2");
    const r = await gerarBackup(fonteFalsa({ brindes: { linhas: [{ id: "1" }], contagem: 2 } }), { destino: dir, tabelas: ["brindes"] });
    expect(r.ok).toBe(false);
    expect(r.manifesto.tabelas.brindes.conferido).toBe(false);
    expect(verificarBackup(dir).ok).toBe(false);
  });

  it("tabela vazia gera arquivo vazio conferido (0 × 0)", async () => {
    const dir = join(novoDir(), "b3");
    const r = await gerarBackup(fonteFalsa(DADOS), { destino: dir, tabelas: ["conferencia"] });
    expect(r.ok).toBe(true);
    expect(r.manifesto.tabelas.conferencia.linhasNoArquivo).toBe(0);
  });

  it("recusa tabela fora da lista, lista vazia e pasta de destino que já tem conteúdo (nunca sobrescreve)", async () => {
    const base = novoDir();
    await expect(gerarBackup(fonteFalsa(DADOS), { destino: join(base, "x"), tabelas: ["usuarios; drop table brindes"] })).rejects.toThrow(/fora da lista/);
    await expect(gerarBackup(fonteFalsa(DADOS), { destino: join(base, "y"), tabelas: [] })).rejects.toThrow(/nenhuma tabela/);
    await gerarBackup(fonteFalsa(DADOS), { destino: join(base, "z"), tabelas: ["brindes"] });
    const antes = readFileSync(join(base, "z", "brindes.jsonl"), "utf-8");
    await expect(gerarBackup(fonteFalsa({ brindes: { linhas: [{ id: "novo" }] } }), { destino: join(base, "z"), tabelas: ["brindes"] })).rejects.toThrow(/não será sobrescrita/);
    expect(readFileSync(join(base, "z", "brindes.jsonl"), "utf-8")).toBe(antes);
  });

  it("a lista padrão cobre as 13 tabelas das cargas", () => {
    expect([...TABELAS_PADRAO].sort()).toEqual(["brindes", "cancelamento_delivery", "cancelamento_salao", "cancelamento_salao_detalhe", "compra_direta", "conferencia", "faturamento", "fechamento_caixa", "formas_pagamento", "pdv_maquininha", "quebra_caixa", "retirada_deposito", "troco"]);
  });
});

describe("verificarBackup", () => {
  it("backup íntegro é verificado; arquivo alterado, removido ou manifesto ausente são detectados", async () => {
    const dir = join(novoDir(), "v1");
    await gerarBackup(fonteFalsa(DADOS), { destino: dir, tabelas: ["brindes", "troco"] });
    expect(verificarBackup(dir)).toMatchObject({ ok: true, problemas: [] });

    writeFileSync(join(dir, "brindes.jsonl"), readFileSync(join(dir, "brindes.jsonl"), "utf-8").replace("10.50", "99.99"));
    const adulterado = verificarBackup(dir);
    expect(adulterado.ok).toBe(false);
    expect(adulterado.problemas.join(" ")).toMatch(/brindes: SHA-256 diferente/);

    rmSync(join(dir, "troco.jsonl"));
    expect(verificarBackup(dir).problemas.join(" ")).toMatch(/troco: arquivo ausente/);

    rmSync(join(dir, "MANIFESTO.json"));
    expect(verificarBackup(dir).problemas[0]).toMatch(/MANIFESTO.json não encontrado/);
  });
});

describe("destinoPadrao", () => {
  it("usa AAAA-MM-DD_pre-gravacao e acrescenta -2, -3… quando a pasta já existe", () => {
    const base = novoDir();
    expect(destinoPadrao(base, "2026-10-26")).toBe(join(base, "2026-10-26_pre-gravacao"));
    writeFileSync(join(base, "x"), "");
    mkdirSync(join(base, "2026-10-26_pre-gravacao"));
    expect(destinoPadrao(base, "2026-10-26")).toBe(join(base, "2026-10-26_pre-gravacao-2"));
  });
});
