import type { CodigoUnidade } from "@painel/shared";

/**
 * Tipos client-safe da Análise Gerencial — sem import de banco (mesmo
 * motivo já documentado em indicadores.ts/retiradaDeposito.ts).
 *
 * Esta tela NÃO cria nenhuma base/regra nova: reaproveita exatamente
 * `buscarIndicador` (Brindes/Cancelamento Salão/Cancelamento Delivery/
 * Retirada Compra Direta, janela D-1 já validada), `buscarControlesCaixa`
 * (Troco = semana real, PDV × Adquirente = D-2, mesma tolerância de
 * 0,005 já usada em PdvMaquininhaTab.tsx) e os semáforos já existentes
 * (`lib/rules/semaforos.ts`). Ver `analiseGerencial.server.ts` para o
 * detalhe de cada seção.
 */

export interface AtencaoLinha {
  indicador: string;
  unidade: CodigoUnidade;
  valor: number;
  percentualFaturamento: number | null;
  situacao: string;
}

export interface ImpactoLinha {
  indicador: string;
  tipo: "loja" | "motivo";
  chave: string;
  valor: number;
}

export interface EvolucaoLinha {
  indicador: string;
  atual: number | null;
  anterior: number | null;
  delta: number | null;
  deltaPercentual: number | null;
}

export interface ComposicaoItem {
  motivo: string;
  valor: number;
  percentualFaturamento: number | null;
  /** false = motivo não controlável pela operação (ex.: parceria comercial) — não deve ser lido como "problema". */
  controlavel?: boolean;
}

export interface ComposicaoGrupo {
  indicador: string;
  itens: ComposicaoItem[];
}

export interface OrientacaoLinha {
  indicador: string;
  unidade: CodigoUnidade | null;
  motivo: string;
  valor: number;
  percentualFaturamento: number | null;
  orientacao: string;
  controlavel?: boolean;
  /** true = ocorrência operacional (ex.: teste de sistema) — não deve ser lida como problema negativo. */
  naoNegativo?: boolean;
  /**
   * Data real da ocorrência que originou a linha — respeitando a janela do
   * indicador (D-1 para Brindes/Cancelamentos/Compra Direta, D-2 para
   * PDV × Adquirente, a data real do caixa para Troco). `null` quando o
   * dado de origem não sustenta uma única data (nunca inventada).
   */
  dataOcorrencia: Date | null;
}

export interface AnaliseGerencialData {
  conectado: boolean;
  disponivel: boolean;
  dataReferencia: Date;
  dataAnteriorLabel: string;
  atencao: AtencaoLinha[];
  impacto: ImpactoLinha[];
  evolucao: EvolucaoLinha[];
  composicao: ComposicaoGrupo[];
  orientacao: OrientacaoLinha[];
}

export interface OrientacaoEntry {
  texto: string;
  /** false = motivo não controlável pela operação — não deve entrar na avaliação de meta/target. */
  controlavel?: boolean;
  /** true = ocorrência operacional (ex.: teste de sistema) — não deve ser tratada como problema negativo. */
  naoNegativo?: boolean;
}

/**
 * Catálogo de orientações por (indicador, motivo) — regras de ação
 * fornecidas explicitamente pela área financeira. Chave = `${indicador}|${motivo}`,
 * usando o texto de `indicador` já usado nas seções de Composição/Atenção
 * desta tela e o texto de `motivo` exatamente como gravado na base (colunas
 * `motivo` de brindes/cancelamento_salao/cancelamento_delivery/compra_direta,
 * ou os rótulos derivados de sinal para Troco / do status já existente para
 * PDV × Adquirente). Motivo sem entrada aqui mostra "Sem orientação
 * cadastrada" — nunca uma ação inventada.
 */
export const ORIENTACOES_POR_MOTIVO: Record<string, OrientacaoEntry> = {
  // --- Cancelamento Salão ---
  "Cancelamento Salão|MOT 04 - FALTA DE PRODUTO": {
    texto:
      "Orientar o gerente a reforçar com os garçons a conferência dos produtos disponíveis no início do turno, evitando lançamentos recorrentes de produtos indisponíveis. O gerente também deve acompanhar as compras para evitar falta de produto.",
  },
  "Cancelamento Salão|MOT 02 - TROCA DE PRODUTO": {
    texto: "Reforçar com o garçom a confirmação do pedido com o cliente antes de realizar o lançamento.",
  },
  "Cancelamento Salão|MOT 03 - ERRO OPERACIONAL": {
    texto: "Reforçar a atenção na operação e a conferência entre garçom e cozinha antes da entrega do pedido.",
  },
  "Cancelamento Salão|MOT 05 - TESTE": {
    texto: "Ocorrência operacional de teste de sistema — não deve ser tratada como ocorrência negativa.",
    naoNegativo: true,
  },
  "Cancelamento Salão|MOT 01 - DESISTENCIA": {
    texto:
      "Atenção ao tempo de preparo, principalmente nos pedidos de balcão/retirada, para reduzir desistências causadas por demora.",
  },
  "Cancelamento Salão|MOT 06 - DESPERDÍCIO": {
    texto: "Desperdício: reforçar a conferência do pedido antes do preparo e identificar a causa da perda para evitar recorrência.",
  },

  // --- Cancelamento Delivery ---
  "Cancelamento Delivery|MOT 02 - ATRASO": {
    texto:
      "Reforçar com os supervisores o acompanhamento do tempo de produção e despacho. O pedido não deve ficar parado na operação. Em caso de atraso fora do padrão, o supervisor deve sinalizar o gerente da cozinha.",
  },
  "Cancelamento Delivery|MOT 03 - ERRO OPERACIONAL": {
    texto: "Reforçar a atenção na operação e a conferência entre garçom e cozinha antes da entrega do pedido.",
  },
  "Cancelamento Delivery|MOT 04 - FALTA DE PRODUTO": {
    texto:
      "Orientar o gerente a reforçar com os garçons a conferência dos produtos disponíveis no início do turno, evitando lançamentos recorrentes de produtos indisponíveis. O gerente também deve acompanhar as compras para evitar falta de produto.",
  },
  "Cancelamento Delivery|MOT 01 - DESISTENCIA/CLIENTE NÃO LOCALIZADO": {
    texto: "Atenção ao tempo de preparo, principalmente para pedidos de balcão/retirada.",
  },
  "Cancelamento Delivery|MOT 05 - ERRO TAON": {
    texto:
      "A logística deve sinalizar e realizar o contato com a plataforma para solicitar o reembolso à unidade quando aplicável.",
  },
  "Cancelamento Delivery|MOT 06 - TESTE DE SISTEMA": {
    texto: "Ocorrência operacional de teste de sistema — não deve ser tratada como ocorrência negativa.",
    naoNegativo: true,
  },

  // --- Brindes ---
  "Brindes|BRINDE PRESENTE": {
    texto:
      "Utilizado principalmente para correção de situação. Reforçar a importância da conferência do pedido antes de chegar ao cliente, buscando reduzir erros que gerem necessidade de presente/correção.",
  },
  "Brindes|BRINDE TAXA EXTRA": {
    texto: "Atenção ao despacho dos pedidos de delivery e conferência cuidadosa antes da saída.",
  },
  "Brindes|CORTESIAS": {
    texto: "Devem ser utilizadas preferencialmente em dias nos quais os brindes relacionados a erros estejam baixos.",
  },
  "Brindes|TRANSFERÊNCIA DE MERCADORIA": {
    texto: "Deve ser evitada.",
  },
  "Brindes|BRINDE ANIVERSARIANTE": {
    texto: "Não controlável — não entra na avaliação de meta/target de brindes.",
    controlavel: false,
  },
  "Brindes|BRINDE CONSUMO FUNCIONARIOS": {
    texto: "Não controlável (refeição de colaborador) — não entra na avaliação de meta/target de brindes.",
    controlavel: false,
  },
  // Desconto de empresas parceiras — na base, cada parceria aparece com o próprio nome como motivo.
  "Brindes|FORTCON - FORTALEZA CONTABILIDADE LTDA": {
    texto: "Desconto de empresa parceira — não controlável, não entra na avaliação de meta/target de brindes.",
    controlavel: false,
  },
  "Brindes|PARCERIA VIZINHOS": {
    texto: "Desconto de empresa parceira — não controlável, não entra na avaliação de meta/target de brindes.",
    controlavel: false,
  },
  "Brindes|AGROPLAY MUSIC LTDA": {
    texto: "Desconto de empresa parceira — não controlável, não entra na avaliação de meta/target de brindes.",
    controlavel: false,
  },
  "Brindes|BANKME S/A": {
    texto: "Desconto de empresa parceira — não controlável, não entra na avaliação de meta/target de brindes.",
    controlavel: false,
  },
  "Brindes|VECTRA": {
    texto: "Desconto de empresa parceira — não controlável, não entra na avaliação de meta/target de brindes.",
    controlavel: false,
  },
  "Brindes|TATA CONSULTANCY SERVICES": {
    texto: "Desconto de empresa parceira — não controlável, não entra na avaliação de meta/target de brindes.",
    controlavel: false,
  },

  // --- Retirada Compra Direta ---
  "Retirada Compra Direta|CMO/FREE": {
    texto: "Acompanhar a escala para evitar utilização desnecessária de free-lance.",
  },
  "Retirada Compra Direta|CMV": {
    texto: "Atenção às compras realizadas em mercados, pois os preços podem ser superiores aos fornecedores habituais.",
  },
  "Retirada Compra Direta|DEVOLUÇÃO E REEMBOLSO": {
    texto:
      "Evitar sempre que possível. Quando houver erro, tentar oferecer um novo pedido ao cliente para manter o consumo. Reembolso deve ser tratado como última alternativa.",
  },

  // --- Troco (motivo derivado do sinal da diferença — Conferência/Troco já classifica por status/diferença) ---
  "Troco|Divergência negativa": {
    texto:
      "Orientar o gerente a reforçar com o funcionário a importância da conferência e contagem correta do troco, evitando diferenças de caixa.",
  },
  "Troco|Divergência positiva / Sobra": {
    texto:
      "Reforçar a conferência correta — o valor de troco informado na abertura deve representar o valor real confirmado.",
  },

  // --- PDV × Adquirente (classificação binária já existente: Ok / Divergente, tolerância 0,005).
  // A regra fornecida descreve 3 níveis de severidade (azul/amarelo/vermelho) que exigiriam um novo
  // corte numérico não fornecido; sem inventar threshold, toda ocorrência hoje classificada como
  // "Divergente" recebe o checklist mais completo (nível vermelho — ação crítica).
  "PDV × Adquirente|Divergente": {
    texto:
      "Ação crítica: acionar imediatamente o gerente da unidade; comparar extratos da máquina com as vendas do PDV; verificar estornos, chargebacks e cancelamentos; reconciliar por bandeira (Visa, Master, Elo, Hiper, PIX); auditar o fechamento de caixa do operador responsável; registrar ocorrência formal; abrir chamado com a adquirente quando necessário.",
  },
};

export function buscarOrientacaoEntry(indicador: string, motivo: string): OrientacaoEntry | null {
  return ORIENTACOES_POR_MOTIVO[`${indicador}|${motivo}`] ?? null;
}

export function buscarOrientacao(indicador: string, motivo: string): string {
  return buscarOrientacaoEntry(indicador, motivo)?.texto ?? "Sem orientação cadastrada";
}
