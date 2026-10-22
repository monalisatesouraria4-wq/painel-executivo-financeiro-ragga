import { describe, expect, it } from "vitest";
import {
  executarCorrecao,
  validarPlano,
  type BancoCorrecao,
  type PlanoCorrecao,
  type RegistroBanco,
  type SnapshotCorrecao,
  type TransacaoCorrecao,
} from "@/lib/import/correcaoChave";

const ID1 = "f12c2337-0be6-431c-a4fc-2550aa51f994";
const ID2 = "3252cfd4-672f-4671-9b73-bbc8de24cb95";
const ID3 = "95f20bdb-cc11-4fe2-9fcd-5ec134ab031e";

const reg = (id: string, unidade: string, data: string, motivo: string, valor: string): RegistroBanco => ({ id, unidade, data, motivo, valor, completo: { id, unidade, data, motivo, valor, criado_em: "2026-10-08" } });

const PLANO: PlanoCorrecao = {
  base: "compraDireta",
  remover: [
    { id: ID1, unidade: "BG 07", data: "2026-10-06", motivo: "FIXAS", valor: "27.96", substituta: { motivo: "OPEX", valor: "27.96" } },
    { id: ID2, unidade: "BG 02", data: "2026-10-07", motivo: "CMO/EMERGENCIAIS", valor: "65.00", substituta: { motivo: "OPEX", valor: "65.00" } },
    { id: ID3, unidade: "BG 13", data: "2026-10-12", motivo: "FIXAS", valor: "38.78", substituta: { motivo: "CMO/EMERGENCIAIS", valor: "38.78" } },
  ],
};

/** Banco em memória com transação real (copia no início, restaura se a função lançar erro). */
class BancoFake implements BancoCorrecao {
  compra: RegistroBanco[];
  outras: Record<string, string[]>;
  chamadasDeEscrita = 0;
  /** força o delete a afetar um nº diferente de linhas (simula divergência) */
  deleteExtra = 0;
  /** lança erro dentro da transação, depois do delete */
  falharNaTransacao = false;
  /** simula outra sessão alterando um registro qualquer DENTRO da janela entre a validação e o commit */
  alteracaoConcorrente = false;
  constructor() {
    this.compra = [
      reg(ID1, "BG 07", "2026-10-06", "FIXAS", "27.96"),
      reg("63779d1d-0aac-4239-8e72-fff56336141c", "BG 07", "2026-10-06", "OPEX", "27.96"),
      reg(ID2, "BG 02", "2026-10-07", "CMO/EMERGENCIAIS", "65.00"),
      reg("91517d4d-381b-4a6c-a4df-6237ca9a64a6", "BG 02", "2026-10-07", "OPEX", "65.00"),
      reg(ID3, "BG 13", "2026-10-12", "FIXAS", "38.78"),
      reg("1573fbce-1320-4437-bde2-05f25027b23f", "BG 13", "2026-10-12", "CMO/EMERGENCIAIS", "38.78"),
      // os "outros só-no-banco" e histórico que NUNCA podem ser tocados
      reg("aaaaaaaa-0000-4000-8000-000000000001", "BG 07", "2026-07-06", "FIXAS", "31.92"),
      reg("aaaaaaaa-0000-4000-8000-000000000002", "BG 13", "2026-07-30", "FIXAS", "33.48"),
      reg("aaaaaaaa-0000-4000-8000-000000000003", "BG 05", "2026-09-10", "FIXAS", "194.96"),
    ];
    this.outras = { brindes: ["b1", "b2"], faturamento: ["f1"], cancelamento_salao: ["c1"], cancelamento_delivery: ["d1"], cancelamento_salao_detalhe: ["x1"] };
  }
  async buscarPorIds(ids: string[]) {
    return this.compra.filter((r) => ids.includes(r.id));
  }
  async buscarDoDia(unidade: string, data: string) {
    return this.compra.filter((r) => r.unidade === unidade && r.data === data).map((r) => ({ motivo: r.motivo, valor: r.valor }));
  }
  private hash(linhas: string[]) {
    return linhas.slice().sort().join("|");
  }
  async snapshot(idsAlvo: string[]): Promise<SnapshotCorrecao> {
    const tabelas: SnapshotCorrecao["tabelas"] = {
      compra_direta: { n: this.compra.length, hash: this.hash(this.compra.map((r) => JSON.stringify(r.completo))) },
    };
    for (const [t, l] of Object.entries(this.outras)) tabelas[t] = { n: l.length, hash: this.hash(l) };
    const sem = this.compra.filter((r) => !idsAlvo.includes(r.id));
    return { tabelas, compraDiretaSemAlvos: { n: sem.length, hash: this.hash(sem.map((r) => JSON.stringify(r.completo))) } };
  }
  async transacao<T>(fn: (tx: TransacaoCorrecao) => Promise<T>): Promise<T> {
    const copia = this.compra.slice();
    const tx: TransacaoCorrecao = {
      buscarPorIds: (ids) => this.buscarPorIds(ids),
      buscarDoDia: (u, d) => this.buscarDoDia(u, d),
      contarCompraDireta: async () => this.compra.length,
      snapshotSemAlvos: async (ids) => {
        const sem = this.compra.filter((r) => !ids.includes(r.id));
        return { n: sem.length, hash: this.hash(sem.map((r) => JSON.stringify(r.completo))) };
      },
      deletarPorIds: async (ids) => {
        this.chamadasDeEscrita++;
        if (this.alteracaoConcorrente) this.compra[this.compra.length - 1] = { ...this.compra[this.compra.length - 1], completo: { ...this.compra[this.compra.length - 1].completo, valor: "999.99" } };
        const antes = this.compra.length;
        this.compra = this.compra.filter((r) => !ids.includes(r.id));
        // simula um delete que afeta linhas além das autorizadas
        for (let i = 0; i < this.deleteExtra; i++) this.compra.pop();
        if (this.falharNaTransacao) throw new Error("erro simulado durante a transação");
        return antes - this.compra.length;
      },
    };
    try {
      return await fn(tx);
    } catch (e) {
      this.compra = copia; // ROLLBACK
      throw e;
    }
  }
}

const backupOk = async () => "backup.json";

describe("validarPlano", () => {
  it("aceita o plano completo de 3 registros", () => expect(validarPlano(PLANO)).toEqual([]));
  it("recusa plano vazio, base errada, id inválido/repetido, campos ausentes e substituta igual ao removido", () => {
    expect(validarPlano({ base: "compraDireta", remover: [] })).not.toEqual([]);
    expect(validarPlano({ ...PLANO, base: "brindes" })).not.toEqual([]);
    expect(validarPlano({ ...PLANO, remover: [{ ...PLANO.remover[0], id: "123" }] })).not.toEqual([]);
    expect(validarPlano({ ...PLANO, remover: [PLANO.remover[0], PLANO.remover[0]] }).join()).toMatch(/repetido/);
    expect(validarPlano({ ...PLANO, remover: [{ ...PLANO.remover[0], motivo: "" }] })).not.toEqual([]);
    expect(validarPlano({ ...PLANO, remover: [{ ...PLANO.remover[0], substituta: { motivo: "FIXAS", valor: "27.96" } }] }).join()).toMatch(/motivo diferente/);
    expect(validarPlano(null)).not.toEqual([]);
  });
  it("recusa exclusão em lote (acima do máximo)", () => {
    const muitos = Array.from({ length: 11 }, (_, i) => ({ ...PLANO.remover[0], id: `aaaaaaaa-0000-4000-8000-0000000001${String(i).padStart(2, "0")}` }));
    expect(validarPlano({ ...PLANO, remover: muitos }).join()).toMatch(/lote/);
  });
});

describe("executarCorrecao — simulação (padrão)", () => {
  it("sem --confirmar não altera nada no banco e não escreve", async () => {
    const banco = new BancoFake();
    const antes = JSON.stringify(banco.compra);
    const r = await executarCorrecao(PLANO, banco, { confirmar: false, gravarBackup: backupOk });
    expect(r.status).toBe("simulacao");
    expect(JSON.stringify(banco.compra)).toBe(antes);
    expect(banco.chamadasDeEscrita).toBe(0);
    if (r.status === "simulacao") expect(r.removeriaCentavos).toBe(2796 + 6500 + 3878);
  });
  it("repetir a simulação produz o mesmo resultado", async () => {
    const banco = new BancoFake();
    const a = await executarCorrecao(PLANO, banco, { confirmar: false });
    const b = await executarCorrecao(PLANO, banco, { confirmar: false });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("executarCorrecao — pré-condições (nada é gravado)", () => {
  it("recusa ID inexistente", async () => {
    const banco = new BancoFake();
    const plano = { ...PLANO, remover: [{ ...PLANO.remover[0], id: "bbbbbbbb-0000-4000-8000-000000000009" }, ...PLANO.remover.slice(1)] };
    const r = await executarCorrecao(plano, banco, { confirmar: true, gravarBackup: backupOk });
    expect(r.status).toBe("pre-condicao-falhou");
    expect(banco.chamadasDeEscrita).toBe(0);
    expect(banco.compra).toHaveLength(9);
  });
  it.each([
    ["unidade", { unidade: "BG 99" }],
    ["data", { data: "2026-10-09" }],
    ["motivo", { motivo: "CMV" }],
    ["valor", { valor: "27.97" }],
  ])("recusa ID com %s divergente do plano", async (_c, mudanca) => {
    const banco = new BancoFake();
    const plano = { ...PLANO, remover: [{ ...PLANO.remover[0], ...mudanca }, ...PLANO.remover.slice(1)] };
    const r = await executarCorrecao(plano, banco, { confirmar: true, gravarBackup: backupOk });
    expect(r.status).toBe("pre-condicao-falhou");
    expect(banco.chamadasDeEscrita).toBe(0);
  });
  it("recusa se o registro já foi alterado (valor mudou no banco)", async () => {
    const banco = new BancoFake();
    banco.compra[0] = { ...banco.compra[0], valor: "30.00" };
    const r = await executarCorrecao(PLANO, banco, { confirmar: true, gravarBackup: backupOk });
    expect(r.status).toBe("pre-condicao-falhou");
    expect(banco.chamadasDeEscrita).toBe(0);
  });
  it("recusa se a chave substituta não existe ou tem outro valor", async () => {
    const semSub = new BancoFake();
    semSub.compra = semSub.compra.filter((r) => r.id !== "63779d1d-0aac-4239-8e72-fff56336141c");
    expect((await executarCorrecao(PLANO, semSub, { confirmar: true, gravarBackup: backupOk })).status).toBe("pre-condicao-falhou");
    const outroValor = new BancoFake();
    outroValor.compra[1] = { ...outroValor.compra[1], valor: "28.00" };
    expect((await executarCorrecao(PLANO, outroValor, { confirmar: true, gravarBackup: backupOk })).status).toBe("pre-condicao-falhou");
  });
  it("plano incompleto é recusado sem tocar no banco", async () => {
    const banco = new BancoFake();
    const r = await executarCorrecao({ base: "compraDireta", remover: [{ id: ID1 }] }, banco, { confirmar: true, gravarBackup: backupOk });
    expect(r.status).toBe("plano-invalido");
    expect(banco.chamadasDeEscrita).toBe(0);
  });
});

describe("executarCorrecao — gravação (--confirmar)", () => {
  it("sem backup configurado a gravação é recusada", async () => {
    const banco = new BancoFake();
    const r = await executarCorrecao(PLANO, banco, { confirmar: true });
    expect(r.status).toBe("pre-condicao-falhou");
    expect(banco.compra).toHaveLength(9);
  });
  it("se o backup falhar, nada é alterado", async () => {
    const banco = new BancoFake();
    const r = await executarCorrecao(PLANO, banco, { confirmar: true, gravarBackup: async () => { throw new Error("disco cheio"); } });
    expect(r.status).toBe("pre-condicao-falhou");
    expect(banco.chamadasDeEscrita).toBe(0);
  });
  it("remove exatamente os 3 IDs, grava backup completo e preserva os demais registros e tabelas", async () => {
    const banco = new BancoFake();
    let salvo: RegistroBanco[] = [];
    const r = await executarCorrecao(PLANO, banco, { confirmar: true, gravarBackup: async (rs) => { salvo = rs; return "backup.json"; } });
    expect(r.status).toBe("gravado");
    expect(salvo.map((x) => x.id).sort()).toEqual([ID1, ID2, ID3].sort());
    expect(salvo.every((x) => "criado_em" in x.completo)).toBe(true); // todos os campos disponíveis
    expect(banco.compra).toHaveLength(6);
    expect(banco.compra.some((x) => [ID1, ID2, ID3].includes(x.id))).toBe(false);
    // as chaves novas e os 3 "outros" permanecem
    expect(banco.compra.map((x) => x.id)).toEqual(expect.arrayContaining(["63779d1d-0aac-4239-8e72-fff56336141c", "aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"]));
    if (r.status === "gravado") {
      expect(r.depois.compraDiretaSemAlvos).toEqual(r.antes.compraDiretaSemAlvos);
      for (const t of ["brindes", "faturamento", "cancelamento_salao", "cancelamento_delivery", "cancelamento_salao_detalhe"]) expect(r.depois.tabelas[t]).toEqual(r.antes.tabelas[t]);
      expect(r.depois.tabelas.compra_direta.n).toBe(r.antes.tabelas.compra_direta.n - 3);
      expect(r.centavosRemovidos).toBe(13174);
    }
  });
  it("REVERTE se o delete afetar mais linhas que o esperado (≠ 3)", async () => {
    const banco = new BancoFake();
    banco.deleteExtra = 1;
    const antes = JSON.stringify(banco.compra);
    const r = await executarCorrecao(PLANO, banco, { confirmar: true, gravarBackup: backupOk });
    expect(r.status).toBe("revertido");
    expect(JSON.stringify(banco.compra)).toBe(antes);
  });
  it("REVERTE (rollback) se ocorrer erro durante a transação", async () => {
    const banco = new BancoFake();
    banco.falharNaTransacao = true;
    const antes = JSON.stringify(banco.compra);
    const r = await executarCorrecao(PLANO, banco, { confirmar: true, gravarBackup: backupOk });
    expect(r.status).toBe("revertido");
    expect(JSON.stringify(banco.compra)).toBe(antes);
  });
  it("REVERTE se outro registro for alterado por outra sessão entre a referência e o commit", async () => {
    const banco = new BancoFake();
    banco.alteracaoConcorrente = true;
    const antes = JSON.stringify(banco.compra);
    const r = await executarCorrecao(PLANO, banco, { confirmar: true, gravarBackup: backupOk });
    expect(r.status).toBe("revertido");
    expect(JSON.stringify(banco.compra)).toBe(antes);
  });
  it("reexecução segura: depois de gravado, repetir recusa (IDs já removidos) e não exclui nada diferente", async () => {
    const banco = new BancoFake();
    await executarCorrecao(PLANO, banco, { confirmar: true, gravarBackup: backupOk });
    const aposPrimeira = JSON.stringify(banco.compra);
    const r2 = await executarCorrecao(PLANO, banco, { confirmar: true, gravarBackup: backupOk });
    expect(r2.status).toBe("pre-condicao-falhou");
    expect(JSON.stringify(banco.compra)).toBe(aposPrimeira);
  });
  it("só remove os IDs do plano, mesmo com outros registros de mesma loja/dia/valor/motivo", async () => {
    const banco = new BancoFake();
    // registro "gêmeo" (mesma loja/dia/valor) em outro motivo: não pode ser tocado
    banco.compra.push(reg("cccccccc-0000-4000-8000-000000000001", "BG 07", "2026-10-06", "CMV", "27.96"));
    await executarCorrecao(PLANO, banco, { confirmar: true, gravarBackup: backupOk });
    expect(banco.compra.some((r) => r.id === "cccccccc-0000-4000-8000-000000000001")).toBe(true);
    expect(banco.compra).toHaveLength(7);
  });
});
