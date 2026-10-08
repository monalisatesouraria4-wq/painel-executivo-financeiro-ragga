/**
 * Controle de uma busca assíncrona com estados explícitos — módulo PURO (sem React, sem banco), para que a tela de
 * Retirada para Depósito nunca fique eternamente em "Carregando…" e para que uma resposta ANTIGA nunca sobrescreva a
 * de um filtro mais recente.
 *
 * Estados: `carregando` → `sucesso` (dados) | `erro` (mensagem). "Vazio" (sucesso sem lançamentos) é decidido pela
 * tela a partir dos dados — é diferente de erro e de carregando. Cada `buscar` invalida as anteriores (token): só a
 * última resposta é aplicada; `cancelar` (desmontagem/troca de filtro) invalida a busca em andamento; `tentarNovamente`
 * executa DE NOVO a última consulta.
 *
 * PRAZO: cada consulta tem no máximo `PRAZO_MAXIMO_MS`. Se não terminar a tempo, o estado vira `erro` (com mensagem de
 * demora) e "Tentar novamente" funciona normalmente; uma resposta tardia dessa consulta é ignorada. O timer é limpo
 * quando a consulta termina, falha, é substituída ou cancelada (sem timers pendentes).
 */

export type EstadoBusca<T> =
  | { estado: "carregando"; chave: string }
  | { estado: "sucesso"; chave: string; dados: T }
  | { estado: "erro"; chave: string; mensagem: string; motivo: MotivoErroBusca };

/** `timeout`: a consulta estourou o prazo; `falha`: erro comum (rede, servidor, exceção). */
export type MotivoErroBusca = "falha" | "timeout";

/**
 * Ações oferecidas na tela para um estado de erro. "Tentar novamente" sempre; "Recarregar página" SOMENTE no timeout
 * (uma ação de servidor pendurada bloqueia as seguintes no navegador até a página ser recarregada). Nunca é automático.
 */
export function acoesDoErro(motivo: MotivoErroBusca): { tentarNovamente: true; recarregarPagina: boolean } {
  return { tentarNovamente: true, recarregarPagina: motivo === "timeout" };
}

export const PRAZO_MAXIMO_MS = 30_000;
export const MENSAGEM_ERRO_BUSCA = "Não foi possível carregar a retirada para depósito agora. Verifique a conexão e tente novamente.";
export const MENSAGEM_ERRO_TIMEOUT = "A consulta demorou demais para responder (mais de 30 segundos). Verifique a conexão e tente novamente.";

const SINAL_TIMEOUT = Symbol("timeout-busca");

export function criarBuscador<T>(aoMudar: (estado: EstadoBusca<T>) => void, prazoMs: number = PRAZO_MAXIMO_MS) {
  let token = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ultima: { chave: string; executar: () => Promise<T> } | null = null;

  function limparTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function buscar(chave: string, executar: () => Promise<T>): Promise<void> {
    ultima = { chave, executar };
    const meu = ++token;
    limparTimer(); // o timer da consulta substituída não pode disparar sobre a nova
    aoMudar({ estado: "carregando", chave });
    try {
      const expirou = new Promise<never>((_, rejeitar) => {
        timer = setTimeout(() => rejeitar(SINAL_TIMEOUT), prazoMs);
      });
      const dados = await Promise.race([executar(), expirou]);
      if (meu === token) aoMudar({ estado: "sucesso", chave, dados });
    } catch (e) {
      if (meu === token) {
        const timeout = e === SINAL_TIMEOUT;
        aoMudar({ estado: "erro", chave, mensagem: timeout ? MENSAGEM_ERRO_TIMEOUT : MENSAGEM_ERRO_BUSCA, motivo: timeout ? "timeout" : "falha" });
      }
    } finally {
      if (meu === token) limparTimer(); // só o dono do token limpa (um timer mais novo não pode ser apagado por uma consulta antiga)
    }
  }

  return {
    buscar,
    /** Repete a última consulta (mesmo filtro), com novo prazo. Sem consulta anterior, não faz nada. */
    tentarNovamente: (): Promise<void> => (ultima ? buscar(ultima.chave, ultima.executar) : Promise.resolve()),
    /** Invalida qualquer busca em andamento (resposta ignorada) e limpa o timer pendente. */
    cancelar: (): void => {
      token++;
      limparTimer();
    },
  };
}
