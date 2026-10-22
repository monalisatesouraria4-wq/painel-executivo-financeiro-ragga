import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gravarBackupSeguro } from "@/lib/import/backupCorrecao";
import type { RegistroBanco } from "@/lib/import/correcaoChave";

const regs: RegistroBanco[] = [
  { id: "f12c2337-0be6-431c-a4fc-2550aa51f994", unidade: "BG 07", data: "2026-10-06", motivo: "FIXAS", valor: "27.96", completo: { id: "f12c2337-0be6-431c-a4fc-2550aa51f994", motivo: "FIXAS", valor: "27.96", criado_em: "2026-10-08", importacao_id: null } },
  { id: "3252cfd4-672f-4671-9b73-bbc8de24cb95", unidade: "BG 02", data: "2026-10-07", motivo: "CMO/EMERGENCIAIS", valor: "65.00", completo: { id: "3252cfd4-672f-4671-9b73-bbc8de24cb95", motivo: "CMO/EMERGENCIAIS", valor: "65.00", criado_em: "2026-10-08", importacao_id: null } },
];
const dirs: string[] = [];
const novoDir = () => { const d = mkdtempSync(join(tmpdir(), "bkp-")); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("gravarBackupSeguro", () => {
  it("grava todos os campos e confere o conteúdo relendo o arquivo", () => {
    const d = novoDir();
    const arq = gravarBackupSeguro(d, { base: "compraDireta" }, regs, new Date("2026-10-15T12:00:00Z"));
    const j = JSON.parse(readFileSync(arq, "utf-8"));
    expect(j.registros).toHaveLength(2);
    expect(j.registros[0]).toHaveProperty("criado_em");
    expect(j.registros[0]).toHaveProperty("importacao_id");
  });
  it("nunca sobrescreve um backup existente", () => {
    const d = novoDir();
    const quando = new Date("2026-10-15T12:00:00Z");
    const arq = gravarBackupSeguro(d, {}, regs, quando);
    const original = readFileSync(arq, "utf-8");
    expect(() => gravarBackupSeguro(d, {}, [regs[0]], quando)).toThrow(/já existe/);
    expect(readFileSync(arq, "utf-8")).toBe(original);
    expect(readdirSync(d)).toHaveLength(1);
  });
  it("recusa diretório vazio (sem destino definido)", () => {
    expect(() => gravarBackupSeguro("", {}, regs)).toThrow(/não informado/);
  });
  it("não aceita arquivo pré-existente com o mesmo nome (flag wx)", () => {
    const d = novoDir();
    const quando = new Date("2026-10-15T12:00:00Z");
    writeFileSync(join(d, `backup-correcao-compra-direta-${quando.toISOString().replace(/[:.]/g, "-")}.json`), "x");
    expect(() => gravarBackupSeguro(d, {}, regs, quando)).toThrow(/já existe/);
  });
});
