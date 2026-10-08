import { afterEach, describe, expect, it, vi } from "vitest";
import { MENSAGEM_ERRO_BUSCA, MENSAGEM_ERRO_TIMEOUT, PRAZO_MAXIMO_MS, acoesDoErro, criarBuscador, type EstadoBusca } from "@/lib/services/retiradaDepositoBusca";

function adiavel<T>() {
  let resolve!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolve = res;
    rejeitar = rej;
  });
  return { promessa, resolve, rejeitar };
}

describe("criarBuscador — estados de carregamento, sucesso e erro", () => {
  it("carregando → sucesso", async () => {
    const eventos: EstadoBusca<number>[] = [];
    const b = criarBuscador<number>((e) => eventos.push(e));
    await b.buscar("a", async () => 42);
    expect(eventos).toEqual([
      { estado: "carregando", chave: "a" },
      { estado: "sucesso", chave: "a", dados: 42 },
    ]);
  });

  it("falha na consulta → estado de erro com mensagem clara (nunca fica em carregando)", async () => {
    const eventos: EstadoBusca<number>[] = [];
    const b = criarBuscador<number>((e) => eventos.push(e));
    await b.buscar("a", async () => {
      throw new Error("rede");
    });
    expect(eventos.at(-1)).toEqual({ estado: "erro", chave: "a", mensagem: MENSAGEM_ERRO_BUSCA, motivo: "falha" });
  });

  it("'Tentar novamente' refaz de fato a consulta e pode ter sucesso", async () => {
    let chamadas = 0;
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    const consulta = async () => {
      chamadas++;
      if (chamadas === 1) throw new Error("falha");
      return "ok";
    };
    await b.buscar("a", consulta);
    expect(eventos.at(-1)?.estado).toBe("erro");
    await b.tentarNovamente();
    expect(chamadas).toBe(2);
    expect(eventos.at(-1)).toEqual({ estado: "sucesso", chave: "a", dados: "ok" });
    expect(eventos.map((e) => e.estado)).toEqual(["carregando", "erro", "carregando", "sucesso"]);
  });

  it("tentarNovamente sem consulta anterior não faz nada", async () => {
    const eventos: EstadoBusca<number>[] = [];
    await criarBuscador<number>((e) => eventos.push(e)).tentarNovamente();
    expect(eventos).toEqual([]);
  });
});

describe("criarBuscador — resposta antiga não sobrescreve filtro mais novo", () => {
  it("a resposta da 1ª consulta chega depois da 2ª e é ignorada", async () => {
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    const primeira = adiavel<string>();
    const segunda = adiavel<string>();
    const p1 = b.buscar("antigo", () => primeira.promessa);
    const p2 = b.buscar("novo", () => segunda.promessa);
    segunda.resolve("dados-novos");
    await p2;
    primeira.resolve("dados-antigos");
    await p1;
    expect(eventos.at(-1)).toEqual({ estado: "sucesso", chave: "novo", dados: "dados-novos" });
    expect(eventos.some((e) => e.estado === "sucesso" && e.chave === "antigo")).toBe(false);
  });

  it("erro de consulta antiga também é ignorado", async () => {
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    const primeira = adiavel<string>();
    const p1 = b.buscar("antigo", () => primeira.promessa);
    const p2 = b.buscar("novo", async () => "ok");
    await p2;
    primeira.rejeitar(new Error("tarde"));
    await p1;
    expect(eventos.at(-1)).toEqual({ estado: "sucesso", chave: "novo", dados: "ok" });
    expect(eventos.some((e) => e.estado === "erro")).toBe(false);
  });

  it("cancelar (desmontagem) ignora a resposta em andamento", async () => {
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    const x = adiavel<string>();
    const p = b.buscar("a", () => x.promessa);
    b.cancelar();
    x.resolve("tarde");
    await p;
    expect(eventos.map((e) => e.estado)).toEqual(["carregando"]);
  });
});

describe("criarBuscador — prazo máximo da consulta (timers controlados)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("o prazo é de 30 segundos", () => {
    expect(PRAZO_MAXIMO_MS).toBe(30_000);
  });

  it("consulta que nunca resolve → erro de demora após 30 s (e não antes)", async () => {
    vi.useFakeTimers();
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    const p = b.buscar("a", () => new Promise<string>(() => {}));
    await vi.advanceTimersByTimeAsync(PRAZO_MAXIMO_MS - 1);
    expect(eventos.map((e) => e.estado)).toEqual(["carregando"]);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(eventos.at(-1)).toEqual({ estado: "erro", chave: "a", mensagem: MENSAGEM_ERRO_TIMEOUT, motivo: "timeout" });
    expect(MENSAGEM_ERRO_TIMEOUT).toMatch(/demorou demais/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limpa o timer após sucesso", async () => {
    vi.useFakeTimers();
    const b = criarBuscador<number>(() => {});
    const p = b.buscar("a", async () => 1);
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limpa o timer após erro da consulta (e a mensagem é a de falha, não a de demora)", async () => {
    vi.useFakeTimers();
    const eventos: EstadoBusca<number>[] = [];
    const b = criarBuscador<number>((e) => eventos.push(e));
    await b.buscar("a", async () => {
      throw new Error("falha");
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(eventos.at(-1)).toEqual({ estado: "erro", chave: "a", mensagem: MENSAGEM_ERRO_BUSCA, motivo: "falha" });
  });

  it("limpa o timer ao cancelar e ao substituir a consulta", async () => {
    vi.useFakeTimers();
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    void b.buscar("a", () => new Promise<string>(() => {}));
    expect(vi.getTimerCount()).toBe(1);
    b.cancelar();
    expect(vi.getTimerCount()).toBe(0);
    void b.buscar("b", () => new Promise<string>(() => {}));
    void b.buscar("c", () => new Promise<string>(() => {}));
    expect(vi.getTimerCount()).toBe(1); // só o da consulta atual
    await vi.advanceTimersByTimeAsync(PRAZO_MAXIMO_MS);
    const erros = eventos.filter((e) => e.estado === "erro");
    expect(erros).toEqual([{ estado: "erro", chave: "c", mensagem: MENSAGEM_ERRO_TIMEOUT, motivo: "timeout" }]); // "a" e "b" nunca viram erro
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resultado tardio após o timeout é ignorado (não sobrescreve o erro)", async () => {
    vi.useFakeTimers();
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    const lenta = adiavel<string>();
    const p = b.buscar("a", () => lenta.promessa);
    await vi.advanceTimersByTimeAsync(PRAZO_MAXIMO_MS);
    await p;
    lenta.resolve("tarde");
    await vi.advanceTimersByTimeAsync(0);
    expect(eventos.map((e) => e.estado)).toEqual(["carregando", "erro"]);
    expect(eventos.some((e) => e.estado === "sucesso")).toBe(false);
  });

  it("falha tardia após o timeout também é ignorada (sem rejeição não tratada)", async () => {
    vi.useFakeTimers();
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    const lenta = adiavel<string>();
    const p = b.buscar("a", () => lenta.promessa);
    await vi.advanceTimersByTimeAsync(PRAZO_MAXIMO_MS);
    await p;
    lenta.rejeitar(new Error("tarde"));
    await vi.advanceTimersByTimeAsync(0);
    expect(eventos.map((e) => e.estado)).toEqual(["carregando", "erro"]);
    expect(eventos.at(-1)).toMatchObject({ mensagem: MENSAGEM_ERRO_TIMEOUT });
  });

  it("resultado tardio de uma consulta que estourou o prazo não sobrescreve uma tentativa mais nova", async () => {
    vi.useFakeTimers();
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    const lenta = adiavel<string>();
    const nova = adiavel<string>();
    let chamadas = 0;
    const consulta = () => (++chamadas === 1 ? lenta.promessa : nova.promessa); // cada tentativa tem a sua própria promessa
    const p1 = b.buscar("a", consulta);
    await vi.advanceTimersByTimeAsync(PRAZO_MAXIMO_MS);
    await p1;
    const p2 = b.tentarNovamente();
    lenta.resolve("antigo"); // a resposta da 1ª chega com a 2ª em andamento
    await vi.advanceTimersByTimeAsync(0);
    expect(eventos.at(-1)).toEqual({ estado: "carregando", chave: "a" });
    expect(eventos.some((e) => e.estado === "sucesso")).toBe(false);
    nova.resolve("novo");
    await p2;
    expect(eventos.at(-1)).toEqual({ estado: "sucesso", chave: "a", dados: "novo" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("depois de um timeout, 'Tentar novamente' funciona e tem um novo prazo de 30 s", async () => {
    vi.useFakeTimers();
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    let chamadas = 0;
    const consulta = () => {
      chamadas++;
      return chamadas === 1 ? new Promise<string>(() => {}) : Promise.resolve("ok");
    };
    const p1 = b.buscar("a", consulta);
    await vi.advanceTimersByTimeAsync(PRAZO_MAXIMO_MS);
    await p1;
    expect(eventos.at(-1)?.estado).toBe("erro");
    await b.tentarNovamente();
    expect(chamadas).toBe(2);
    expect(eventos.at(-1)).toEqual({ estado: "sucesso", chave: "a", dados: "ok" });
    expect(eventos.map((e) => e.estado)).toEqual(["carregando", "erro", "carregando", "sucesso"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("consulta que responde dentro do prazo não vira erro mesmo após o prazo passar", async () => {
    vi.useFakeTimers();
    const eventos: EstadoBusca<string>[] = [];
    const b = criarBuscador<string>((e) => eventos.push(e));
    const x = adiavel<string>();
    const p = b.buscar("a", () => x.promessa);
    await vi.advanceTimersByTimeAsync(PRAZO_MAXIMO_MS - 1000);
    x.resolve("a-tempo");
    await p;
    await vi.advanceTimersByTimeAsync(PRAZO_MAXIMO_MS * 2);
    expect(eventos.map((e) => e.estado)).toEqual(["carregando", "sucesso"]);
  });
});

describe("criarBuscador — motivo do erro e ações de recuperação", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("erro comum → motivo 'falha': só 'Tentar novamente', sem 'Recarregar página'", async () => {
    const eventos: EstadoBusca<number>[] = [];
    const b = criarBuscador<number>((e) => eventos.push(e));
    await b.buscar("a", async () => {
      throw new Error("rede");
    });
    const ultimo = eventos.at(-1)!;
    expect(ultimo.estado === "erro" && ultimo.motivo).toBe("falha");
    expect(acoesDoErro("falha")).toEqual({ tentarNovamente: true, recarregarPagina: false });
  });

  it("timeout → motivo 'timeout' (código explícito, não o texto): 'Tentar novamente' e 'Recarregar página'", async () => {
    vi.useFakeTimers();
    const eventos: EstadoBusca<number>[] = [];
    const b = criarBuscador<number>((e) => eventos.push(e));
    const p = b.buscar("a", () => new Promise<number>(() => {}));
    await vi.advanceTimersByTimeAsync(PRAZO_MAXIMO_MS);
    await p;
    const ultimo = eventos.at(-1)!;
    expect(ultimo.estado === "erro" && ultimo.motivo).toBe("timeout");
    expect(acoesDoErro("timeout")).toEqual({ tentarNovamente: true, recarregarPagina: true });
  });

  it("o motivo não depende da mensagem: erro comum cujo texto lembra demora continua sendo 'falha'", async () => {
    const eventos: EstadoBusca<number>[] = [];
    const b = criarBuscador<number>((e) => eventos.push(e));
    await b.buscar("a", async () => {
      throw new Error(MENSAGEM_ERRO_TIMEOUT);
    });
    const ultimo = eventos.at(-1)!;
    expect(ultimo.estado === "erro" && ultimo.motivo).toBe("falha");
  });

  it("depois de um timeout, uma falha comum volta a ter motivo 'falha' (sem recarga)", async () => {
    vi.useFakeTimers();
    const eventos: EstadoBusca<number>[] = [];
    const b = criarBuscador<number>((e) => eventos.push(e));
    let n = 0;
    const consulta = () => (++n === 1 ? new Promise<number>(() => {}) : Promise.reject(new Error("rede")));
    const p1 = b.buscar("a", consulta);
    await vi.advanceTimersByTimeAsync(PRAZO_MAXIMO_MS);
    await p1;
    await b.tentarNovamente();
    const ultimo = eventos.at(-1)!;
    expect(ultimo.estado === "erro" && ultimo.motivo).toBe("falha");
  });
});
