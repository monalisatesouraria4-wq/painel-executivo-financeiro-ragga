import type { TipoBase } from "@painel/shared";

/**
 * Identifica o tipo de base pela estrutura (cabeçalho de colunas),
 * não pelo nome do arquivo (planejamento, item 2 da Etapa 3).
 *
 * Assinaturas confirmadas inspecionando os arquivos reais do projeto
 * (Etapa 3). Cada coluna exigida pode ser "igual" (a célula do
 * cabeçalho deve ser exatamente esse texto) ou "contem" (a célula deve
 * conter esse texto). "igual" é usado onde há risco real de colisão —
 * ex.: a aba "coud" de retirada_deposito tem coluna "Motivo/Descrição"
 * (uma célula só), enquanto compra_direta tem "Motivo" e "Descrição"
 * como colunas separadas. Um "contains" por "MOTIVO" colidiria com as
 * duas; "igual" resolve a ambiguidade.
 */
type ModoColuna = "igual" | "contem";

interface Assinatura {
  tipoBase: TipoBase;
  colunas: { texto: string; modo: ModoColuna }[];
}

function normalizarCabecalho(valor: unknown): string {
  return String(valor ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove acentos
}

function igual(texto: string) {
  return { texto: normalizarCabecalho(texto), modo: "igual" as const };
}
function contem(texto: string) {
  return { texto: normalizarCabecalho(texto), modo: "contem" as const };
}

const ASSINATURAS: Assinatura[] = [
  {
    tipoBase: "brindes",
    colunas: [contem("LOJA"), igual("TIPO"), igual("MOTIVO"), contem("CAIXA"), contem("CUPOM"), contem("MOTIVO 02")],
  },
  {
    tipoBase: "cancelamento_salao",
    colunas: [contem("FILIAL"), contem("COMANDA"), contem("DATA/HORA ESTORNO"), igual("MOTIVO")],
  },
  {
    tipoBase: "cancelamento_delivery",
    colunas: [contem("FILIAL"), contem("ENTREGADOR"), contem("NR. PEDIDO"), igual("MOTIVO")],
  },
  {
    // "igual" em MOTIVO e DESCRICAO separa de retirada_deposito, que tem
    // a coluna "Motivo/Descrição" (combinada), não "Descrição" isolada.
    tipoBase: "compra_direta",
    colunas: [contem("FILIAL"), contem("CAIXA"), contem("DATA"), contem("VALOR"), igual("MOTIVO"), igual("DESCRICAO")],
  },
  {
    // Fonte oficial confirmada: Retirada Depósito.xlsx — única variante
    // com "Motivo" E "Motivo/Descrição" como colunas separadas (as
    // outras abas/arquivos candidatos só têm "Motivo/Descrição", sem
    // "Motivo" isolado, e por isso não batem nesta assinatura).
    tipoBase: "retirada_deposito",
    colunas: [contem("FILIAL"), contem("CAIXA"), contem("DATA"), contem("VALOR"), igual("MOTIVO"), contem("MOTIVO/DESCRICAO")],
  },
  {
    tipoBase: "troco",
    colunas: [contem("LOJA"), contem("DATA"), contem("CAIXA"), contem("TROCO CONFERIDO"), contem("TROCO")],
  },
  {
    tipoBase: "fechamento_caixa",
    colunas: [igual("DATA"), igual("FILIAL"), igual("CAIXA"), contem("MOVTO")],
  },
];

/**
 * @param cabecalho Valores da linha de cabeçalho (linha 1 da planilha,
 *   para as bases "em lista simples"). Conferência e Quebra de Caixa não
 *   usam este detector — são identificadas pela estrutura de abas do
 *   arquivo (ver lib/import/resolverAbaDoArquivo.ts) e por parser
 *   próprio, já que o cabeçalho real fica na linha 4/6, não na linha 1.
 */
export function detectarTipoBase(cabecalho: unknown[]): TipoBase | null {
  const colunas = cabecalho.map(normalizarCabecalho);

  for (const assinatura of ASSINATURAS) {
    const todasPresentes = assinatura.colunas.every(({ texto, modo }) =>
      modo === "igual"
        ? colunas.some((coluna) => coluna === texto)
        : colunas.some((coluna) => coluna.includes(texto))
    );
    if (todasPresentes) {
      return assinatura.tipoBase;
    }
  }

  return null;
}
