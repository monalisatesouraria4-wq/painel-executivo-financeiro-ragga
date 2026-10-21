/**
 * Trava ÚNICA das exclusões da sincronização (comando, tela e Server Action): são OPT-IN em TODOS os ambientes.
 * Só `SINCRONIZACAO_EXCLUSOES_HABILITADAS=1` (exatamente "1") libera. Variável ausente, "0", vazia ou qualquer outro valor
 * ("true", "yes", " 1 ") = BLOQUEADO. Lida a cada chamada (nunca em cache), para que alterar a variável valha imediatamente.
 */
export const VARIAVEL_EXCLUSOES = "SINCRONIZACAO_EXCLUSOES_HABILITADAS";

export function exclusoesHabilitadas(env: Record<string, string | undefined> = process.env): boolean {
  return env[VARIAVEL_EXCLUSOES] === "1";
}

export const MOTIVO_EXCLUSOES_DESABILITADAS = `Exclusões desabilitadas: defina ${VARIAVEL_EXCLUSOES}=1 explicitamente (ausente ou 0 = bloqueado).`;
