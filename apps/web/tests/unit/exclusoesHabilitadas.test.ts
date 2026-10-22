import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOTIVO_EXCLUSOES_DESABILITADAS, VARIAVEL_EXCLUSOES, exclusoesHabilitadas } from "@/lib/import/exclusoesHabilitadas";

describe("trava de exclusões (opt-in em todos os ambientes)", () => {
  it("só o valor exato '1' libera", () => {
    expect(exclusoesHabilitadas({ [VARIAVEL_EXCLUSOES]: "1" })).toBe(true);
  });
  it.each([undefined, "", "0", "true", "TRUE", "yes", "sim", " 1", "1 ", "01", "2"])("valor %j NÃO libera", (v) => {
    expect(exclusoesHabilitadas({ [VARIAVEL_EXCLUSOES]: v })).toBe(false);
  });
  it("ambiente de desenvolvimento/teste/produção não altera o padrão: sem a variável, bloqueado", () => {
    for (const nodeEnv of ["development", "test", "production", undefined]) {
      expect(exclusoesHabilitadas({ NODE_ENV: nodeEnv })).toBe(false);
    }
  });
  it("a mensagem de bloqueio cita a variável", () => {
    expect(MOTIVO_EXCLUSOES_DESABILITADAS).toContain("SINCRONIZACAO_EXCLUSOES_HABILITADAS=1");
  });
  it("o código de sincronização não decide exclusão por NODE_ENV (sem atalho por ambiente)", () => {
    for (const arq of ["lib/actions/sincronizacaoBases.ts", "lib/import/bancoSincronizacaoPg.ts", "lib/import/exclusoesHabilitadas.ts"]) {
      const fonte = readFileSync(arq, "utf-8");
      const linhas = fonte.split("\n").filter((l) => /NODE_ENV/.test(l) && !l.trim().startsWith("//") && !l.trim().startsWith("*"));
      // única referência permitida a NODE_ENV: escolher o diretório padrão de BACKUP (nunca habilitar exclusões)
      expect(linhas.every((l) => /backups-sincronizacao/.test(l))).toBe(true);
    }
  });
});
