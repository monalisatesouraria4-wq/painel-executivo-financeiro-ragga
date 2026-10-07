/**
 * Estrutura de navegação do sidebar. Reflete exatamente as rotas já
 * existentes em app/ — nenhum módulo novo foi inventado aqui.
 */
export interface ItemNavegacao {
  nome: string;
  href: string;
  icone: string;
}

export const NAVEGACAO_PRINCIPAL: ItemNavegacao[] = [
  { nome: "Visão Geral", href: "/visao-geral", icone: "🏠" },
  { nome: "Retiradas", href: "/retiradas", icone: "💰" },
  { nome: "Comparativo", href: "/comparativo", icone: "📈" },
  { nome: "Indicadores", href: "/indicadores", icone: "📊" },
  { nome: "Controles de Caixa", href: "/controles-caixa", icone: "🧾" },
  { nome: "Fechamento WhatsApp", href: "/fechamento-whatsapp", icone: "💬" },
  { nome: "Fechamento Semanal", href: "/fechamento-semanal", icone: "🗓️" },
  { nome: "Resumo Semanal Executivo", href: "/resumo-semanal", icone: "📋" },
];

export const NAVEGACAO_ADMIN: ItemNavegacao[] = [
  { nome: "Importação de Bases", href: "/importacao", icone: "⚙️" },
];
