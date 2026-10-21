import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const rodar = (args: string[]) => spawnSync(process.execPath, ["scripts/painel-sincronizacao.mjs", ...args], { encoding: "utf-8", timeout: 30_000 });
const pastaDuravel = resolve(".teste-backup-sincronizacao");
afterAll(() => rmSync(pastaDuravel, { recursive: true, force: true }));

describe("scripts/painel-sincronizacao.mjs — modo sincronização (exclusões habilitadas só na instância)", () => {
  it("exige --backup-dir", () => {
    const r = rodar(["--simular"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--backup-dir/);
  });
  it("recusa pasta de backup na pasta temporária do sistema (não durável)", () => {
    const r = rodar(["--simular", "--backup-dir", resolve(tmpdir(), "backup-x")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/temporária/);
  });
  it("com pasta durável, --simular valida e NÃO sobe servidor; não toca no .env.local", () => {
    const r = rodar(["--simular", "--backup-dir", pastaDuravel]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/exclusões HABILITADAS só nesta instância/);
    expect(r.stdout).toMatch(/nenhum servidor foi iniciado/);
    expect(existsSync(pastaDuravel)).toBe(true);
  });
  it("porta inválida é recusada", () => {
    expect(rodar(["--simular", "--backup-dir", pastaDuravel, "--porta", "abc"]).status).toBe(2);
  });
});
