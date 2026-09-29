/**
 * Regra de depósito (planejamento, "DEPÓSITO"):
 * Segunda a quinta -> depósito na sexta.
 * Sexta a domingo -> depósito na segunda seguinte.
 */
export function dataDeDeposito(dataMovimento: Date): Date {
  // Usa métodos UTC consistentemente: datas de negócio (ex. "2026-09-24")
  // são parseadas como UTC meia-noite; misturar com getDay/setDate (hora
  // local) desalinha o dia em fusos diferentes de UTC (ex. Brasil, UTC-3).
  const diaSemana = dataMovimento.getUTCDay(); // 0=domingo .. 6=sábado
  const d = new Date(dataMovimento.getTime());

  if (diaSemana >= 1 && diaSemana <= 4) {
    // segunda(1) a quinta(4) -> sexta da mesma semana
    d.setUTCDate(d.getUTCDate() + (5 - diaSemana));
    return d;
  }

  // sexta(5), sábado(6), domingo(0) -> segunda seguinte
  const diasAteSegunda = diaSemana === 5 ? 3 : diaSemana === 6 ? 2 : 1;
  d.setUTCDate(d.getUTCDate() + diasAteSegunda);
  return d;
}

/**
 * Início do ciclo de depósito que contém `data` — porta fiel de
 * `getCicloInfo` do painel legado (auditoria funcional, Retiradas):
 * segunda(1) a quinta(4) -> início é a segunda-feira da mesma semana;
 * sexta(5) -> início é a própria sexta; sábado(6)/domingo(0) -> início é
 * a sexta anterior. Mesma regra semanal de `dataDeDeposito`, não uma
 * regra nova — só devolve a outra ponta (início, não o dia do depósito).
 */
export function inicioCicloDeposito(data: Date): Date {
  const diaSemana = data.getUTCDay();
  const d = new Date(data.getTime());

  if (diaSemana >= 1 && diaSemana <= 4) {
    d.setUTCDate(d.getUTCDate() - (diaSemana - 1));
    return d;
  }

  const diasDesdeSexta = diaSemana === 5 ? 0 : diaSemana === 6 ? 1 : 2;
  d.setUTCDate(d.getUTCDate() - diasDesdeSexta);
  return d;
}
