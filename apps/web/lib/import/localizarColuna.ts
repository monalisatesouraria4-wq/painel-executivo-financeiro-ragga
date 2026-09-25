function normalizar(valor: unknown): string {
  return String(valor ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Localiza o índice de uma coluna pelo texto do cabeçalho (contains,
 * sem acento/caixa). Usado pelos parsers para não depender da ORDEM das
 * colunas — apenas do texto do cabeçalho (planejamento, item 2).
 */
export function localizarColuna(cabecalho: unknown[], textoBuscado: string): number {
  const alvo = normalizar(textoBuscado);
  return cabecalho.findIndex((c) => normalizar(c).includes(alvo));
}

/** Variante que exige igualdade exata (evita colisão entre colunas parecidas). */
export function localizarColunaExata(cabecalho: unknown[], textoBuscado: string): number {
  const alvo = normalizar(textoBuscado);
  return cabecalho.findIndex((c) => normalizar(c) === alvo);
}
