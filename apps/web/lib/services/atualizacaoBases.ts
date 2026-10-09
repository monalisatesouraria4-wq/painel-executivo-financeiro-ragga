import type { TipoBase } from "@painel/shared";
import { lerArquivoExcel } from "@/lib/import/lerArquivoExcel";
import { aplicarGravacao } from "@/lib/import/aplicarGravacao";
import { simularGravacao } from "@/lib/import/simularGravacao";
import { localizarColuna, localizarColunaExata } from "@/lib/import/localizarColuna";
import { resolverAbaConferenciaPorData, type AbaConferenciaBruta } from "@/lib/import/resolverAbaConferencia";
import { resolverAbaQuebraPorData, type AbaQuebraBruta } from "@/lib/import/resolverAbaQuebra";
import { persistirBaseNoBanco } from "@/lib/actions/persistirBase";
import { parseFaturamento } from "@/lib/import/parsers/faturamento";
import { parseFechamentoCaixa } from "@/lib/import/parsers/fechamentoCaixa";
import { parsePdvMaquininha } from "@/lib/import/parsers/pdvMaquininha";
import { parseTroco } from "@/lib/import/parsers/troco";
import { parseRetiradaDeposito } from "@/lib/import/parsers/retiradaDeposito";
import { parseListaSimples, CONFIGS_LISTA_SIMPLES } from "@/lib/import/parsers/listaSimples";
import { parseConferencia } from "@/lib/import/parsers/conferencia";
import { parseQuebraCaixa } from "@/lib/import/parsers/quebraCaixa";
import { parseDataCelula } from "@/lib/import/parseCelula";
import type { ResultadoParse, RegistroBase } from "@/lib/import/tipos";

/**
 * Camada de orquestração da "Atualização de Bases" — espelha
 * `renderBaseUpdatePanel` + os 10 modais dedicados do legado (auditoria
 * funcional confirmada por código-fonte). Reaproveita 100% dos parsers,
 * chaves e regras de merge JÁ VALIDADOS — esta camada só lê o arquivo no
 * navegador (`lerArquivoExcel`), valida colunas, chama o parser
 * correspondente e aplica o resultado ao estado em memória
 * (`aplicarGravacao`), reproduzindo o padrão
 * upload → leitura → validação → parser → backup → merge → aplica
 * (ou preserva o estado anterior em caso de erro) confirmado no legado.
 *
 * Nesta etapa NÃO há conexão com banco — "aplicar" significa apenas
 * atualizar o estado React em memória do navegador (perdido ao recarregar
 * a página, igual ao aviso do legado: "Válido apenas para esta sessão do
 * navegador").
 */

export type BaseId =
  | "pdvMaquininha"
  | "troco"
  | "fechamento"
  | "retiradaDeposito"
  | "brindes"
  | "cancelamentoSalao"
  | "cancelamentoDelivery"
  | "compraDireta"
  | "faturamento"
  | "conferencia"
  | "quebraCaixa";

interface ColunaObrigatoria {
  rotulo: string;
  coluna: string;
  exata: boolean;
  /** Outros nomes aceitos para a mesma coluna (ex.: layout novo da extração). */
  alternativas?: string[];
}

export interface BaseInfo {
  id: BaseId;
  tipoBase: TipoBase;
  nome: string;
  icone: string;
  alimenta: string;
  arquivoEsperado: string;
  colunasObrigatorias: ColunaObrigatoria[] | null; // null = Conferência (validação própria, não por lista de colunas)
}

function colunasDeConfigListaSimples(chave: keyof typeof CONFIGS_LISTA_SIMPLES): ColunaObrigatoria[] {
  const config = CONFIGS_LISTA_SIMPLES[chave];
  const colunas: ColunaObrigatoria[] = [
    { rotulo: config.colunaUnidade, coluna: config.colunaUnidade, exata: false },
    { rotulo: config.colunaData, coluna: config.colunaData, exata: false },
  ];
  if (config.colunaValor) colunas.push({ rotulo: config.colunaValor, coluna: config.colunaValor, exata: false });
  for (const extra of config.camposExtras) {
    colunas.push({ rotulo: extra.coluna, coluna: extra.coluna, exata: extra.exata ?? false });
  }
  return colunas;
}

export const BASE_REGISTRY: BaseInfo[] = [
  {
    id: "faturamento",
    tipoBase: "faturamento",
    nome: "Faturamento",
    icone: "💰",
    alimenta: "Visão Geral, Indicadores, Retiradas, Fechamento WhatsApp/Semanal",
    arquivoEsperado: "VENDAS.xlsx",
    colunasObrigatorias: [
      { rotulo: "Filial", coluna: "FILIAL", exata: true },
      { rotulo: "Data", coluna: "DATA", exata: true },
      { rotulo: "Vl. Pagamento", coluna: "VL. PAGAMENTO", exata: false },
      { rotulo: "Desc. Pagam.", coluna: "DESC. PAGAM.", exata: false },
    ],
  },
  {
    id: "brindes",
    tipoBase: "brindes",
    nome: "Brindes",
    icone: "🎁",
    alimenta: "Visão Geral, Indicadores",
    arquivoEsperado: "BRINDES.xlsx",
    colunasObrigatorias: colunasDeConfigListaSimples("brindes"),
  },
  {
    id: "cancelamentoSalao",
    tipoBase: "cancelamento_salao",
    nome: "Cancelamento Salão",
    icone: "❌",
    alimenta: "Visão Geral, Indicadores",
    arquivoEsperado: "CANCEL_SALÃO.xlsx",
    colunasObrigatorias: colunasDeConfigListaSimples("cancelamento_salao"),
  },
  {
    id: "cancelamentoDelivery",
    tipoBase: "cancelamento_delivery",
    nome: "Cancelamento Delivery",
    icone: "❌",
    alimenta: "Visão Geral, Indicadores",
    arquivoEsperado: "CANCELAMENTOS_DELIVERY.xlsx",
    colunasObrigatorias: colunasDeConfigListaSimples("cancelamento_delivery"),
  },
  {
    id: "compraDireta",
    tipoBase: "compra_direta",
    nome: "Retirada Compra Direta",
    icone: "📌",
    alimenta: "Retiradas, Visão Geral",
    arquivoEsperado: "COMPRA_DIRETA.xlsx",
    colunasObrigatorias: colunasDeConfigListaSimples("compra_direta"),
  },
  {
    id: "retiradaDeposito",
    tipoBase: "retirada_deposito",
    nome: "Retirada para Depósito",
    icone: "💰",
    alimenta: "Retiradas, Visão Geral",
    arquivoEsperado: "Retirada_Depósito.xlsx",
    colunasObrigatorias: colunasDeConfigListaSimples("retirada_deposito"),
  },
  {
    id: "fechamento",
    tipoBase: "fechamento_caixa",
    nome: "Fechamento",
    icone: "📦",
    alimenta: "Controles de Caixa, Visão Geral",
    arquivoEsperado: "FECHAMENTO_DE_CAIXA...xlsx",
    colunasObrigatorias: [
      { rotulo: "Data", coluna: "DATA", exata: true },
      { rotulo: "Filial", coluna: "FILIAL", exata: true },
      { rotulo: "Caixa", coluna: "CAIXA", exata: true },
      { rotulo: "Movto.", coluna: "MOVTO.", exata: true },
      { rotulo: "Abertura", coluna: "ABERTURA", exata: true },
      { rotulo: "Fechamento", coluna: "FECHAMENTO", exata: true },
      { rotulo: "Operador", coluna: "OPERADOR", exata: true },
      { rotulo: "Situação", coluna: "SITUACAO", exata: true },
      { rotulo: "Dif. Fech.", coluna: "DIF. FECH.", exata: true },
      { rotulo: "Dif. Conc.", coluna: "DIF. CONC.", exata: true },
      { rotulo: "Dif. Total", coluna: "DIF. TOTAL", exata: true },
    ],
  },
  {
    id: "pdvMaquininha",
    tipoBase: "pdv_maquininha",
    nome: "PDV × Maquininha",
    icone: "💳",
    alimenta: "Controles de Caixa, Visão Geral",
    arquivoEsperado: "PDV_X_Adquirente...xlsx",
    colunasObrigatorias: [
      { rotulo: "Loja", coluna: "LOJA", exata: false },
      { rotulo: "Data", coluna: "DATA", exata: false },
      { rotulo: "Forma de Pag. (ou Tipo_Pagamento)", coluna: "FORMA DE PAG", exata: false, alternativas: ["TIPO_PAGAMENTO", "TIPO PAGAMENTO"] },
      { rotulo: "Venda (PDV)", coluna: "VENDA", exata: false },
      { rotulo: "Total Maq.", coluna: "TOTAL MAQ", exata: false },
      { rotulo: "Diferença", coluna: "DIFEREN", exata: false },
    ],
  },
  {
    id: "troco",
    tipoBase: "troco",
    nome: "Troco",
    icone: "💵",
    alimenta: "Controles de Caixa, Visão Geral",
    arquivoEsperado: "TROCO_SEMANAL.xlsx",
    colunasObrigatorias: [
      { rotulo: "Loja", coluna: "LOJA", exata: false },
      { rotulo: "Data", coluna: "DATA", exata: false },
      { rotulo: "Caixa", coluna: "CAIXA", exata: false },
      { rotulo: "Troco Conferido", coluna: "TROCO CONFERIDO", exata: false },
      { rotulo: "Troco Informado", coluna: "TROCO INFORMADO", exata: false },
    ],
  },
  {
    id: "conferencia",
    tipoBase: "conferencia",
    nome: "Conferência",
    icone: "📋",
    alimenta: "Controles de Caixa, Visão Geral",
    arquivoEsperado: "CONTROLE_DE_CONFERENCIA...xlsx",
    colunasObrigatorias: null,
  },
  {
    id: "quebraCaixa",
    tipoBase: "quebra_caixa",
    nome: "Quebra de Caixa",
    icone: "🧮",
    alimenta: "Controles de Caixa, Visão Geral",
    arquivoEsperado: "CONTROLE_DE_CONFERENCIA...xlsx",
    colunasObrigatorias: null, // estrutura por abas (uma por período) — validação própria, ver processarArquivoBase
  },
];

export function buscarBaseInfo(id: BaseId): BaseInfo {
  const info = BASE_REGISTRY.find((b) => b.id === id);
  if (!info) throw new Error(`Base desconhecida: ${id}`);
  return info;
}

/** Rótulos das colunas obrigatórias NÃO encontradas (aceita os nomes alternativos de cada coluna). */
export function validarColunas(cabecalho: unknown[], colunas: ColunaObrigatoria[]): string[] {
  const faltando: string[] = [];
  for (const col of colunas) {
    const achou = [col.coluna, ...(col.alternativas ?? [])].some((nome) => (col.exata ? localizarColunaExata(cabecalho, nome) : localizarColuna(cabecalho, nome)) !== -1);
    if (!achou) faltando.push(col.rotulo);
  }
  return faltando;
}

/** Texto de "nenhuma linha válida" por base — porta fiel do legado (uma variação por base). */
const MENSAGEM_ZERO_REGISTROS: Record<BaseId, string> = {
  pdvMaquininha: "Nenhuma linha válida (com filial reconhecida e data válida) foi encontrada.",
  troco: "Nenhuma linha válida foi encontrada (filial reconhecida, data e caixa preenchidos, valores numéricos de troco).",
  fechamento: "Nenhuma linha válida foi encontrada (filial reconhecida, data, caixa e movto. preenchidos).",
  retiradaDeposito: "Nenhuma linha válida foi encontrada (filial reconhecida, data e valor numérico).",
  brindes: "Nenhuma linha válida foi encontrada (filial reconhecida, data e valor numérico).",
  cancelamentoSalao: "Nenhuma linha válida foi encontrada (filial reconhecida, data e valor numérico).",
  cancelamentoDelivery: "Nenhuma linha válida foi encontrada (filial reconhecida, data e valor numérico).",
  compraDireta: "Nenhuma linha válida foi encontrada (filial reconhecida, data e valor numérico).",
  faturamento: "Nenhuma linha válida foi encontrada (filial reconhecida, data e valor numérico).",
  conferencia: "Nenhuma linha válida foi encontrada nesta aba.",
  quebraCaixa: "Nenhuma linha válida foi encontrada nesta aba (loja reconhecida, data e valor de quebra numérico).",
};

export type ResultadoImportacao =
  | {
      status: "sucesso";
      mensagem: string;
      inseridos: number;
      atualizados: number;
      totalFinal: number;
      novoEstado: RegistroBase[];
      persistidoNoBanco: boolean;
      /** Período (min/max data) encontrado NO ARQUIVO enviado — item 7 da etapa de revisão. */
      periodoArquivoInicio: Date;
      periodoArquivoFim: Date;
      /** Linhas rejeitadas pelo parser (unidade não reconhecida, data/valor inválido etc.). */
      rejeitados: number;
    }
  | { status: "erro"; mensagem: string };

function executarParser(id: BaseId, cabecalho: unknown[], linhas: unknown[][]): ResultadoParse {
  switch (id) {
    case "faturamento":
      return parseFaturamento(cabecalho, linhas);
    case "fechamento":
      return parseFechamentoCaixa(cabecalho, linhas);
    case "pdvMaquininha":
      return parsePdvMaquininha(cabecalho, linhas);
    case "troco":
      return parseTroco(cabecalho, linhas);
    case "retiradaDeposito":
      return parseRetiradaDeposito(cabecalho, linhas);
    case "brindes":
      return parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.brindes);
    case "cancelamentoSalao":
      return parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.cancelamento_salao);
    case "cancelamentoDelivery":
      return parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.cancelamento_delivery);
    case "compraDireta":
      return parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.compra_direta);
    default:
      throw new Error(`executarParser não se aplica a ${id} — Conferência usa fluxo próprio.`);
  }
}

/**
 * Processa o upload de uma base: lê o arquivo, valida colunas, chama o
 * parser correspondente e aplica o resultado sobre `estadoAnterior`.
 * Em qualquer erro, `estadoAnterior` é devolvido intacto (rollback —
 * nunca aplica estado parcial), reproduzindo o padrão
 * backup/try/catch do legado.
 */
export async function processarArquivoBase(
  id: BaseId,
  file: File,
  estadoAnterior: RegistroBase[],
  dataReferencia: Date
): Promise<ResultadoImportacao> {
  const info = buscarBaseInfo(id);

  let planilha;
  try {
    planilha = await lerArquivoExcel(file);
  } catch (err) {
    return { status: "erro", mensagem: `Arquivo não aprovado. ${err instanceof Error ? err.message : "Falha ao ler o arquivo."}` };
  }

  let parseResult: ResultadoParse;
  let fonteConferencia: import("@/lib/db/persistencia").FonteConferencia | undefined;
  let fonteQuebraCaixa: import("@/lib/db/persistencia").FonteQuebraCaixa | undefined;

  if (id === "quebraCaixa") {
    const abasBrutas: AbaQuebraBruta[] = Object.entries(planilha.sheets).map(([nomeAba, linhas]) => {
      const cabecalho = linhas[3] ?? []; // linha 4 (índice 3) — cabeçalho real das abas de Quebra
      const idxData = localizarColuna(cabecalho, "DATA");
      const idxLoja = localizarColuna(cabecalho, "LOJA");
      const datasLancamentos: Date[] = [];
      for (const linha of linhas.slice(4)) {
        const loja = linha[idxLoja];
        if (loja === null || loja === undefined || loja === "") continue;
        const data = parseDataCelula(linha[idxData]);
        if (data) datasLancamentos.push(data);
      }
      return { nomeAba, datasLancamentos };
    });
    const resolucao = resolverAbaQuebraPorData(dataReferencia, abasBrutas);
    if (!resolucao.resultado.ok) {
      const motivo =
        resolucao.resultado.erro === "NENHUMA_ABA_CORRESPONDE"
          ? "Nenhuma aba do arquivo cobre a data de referência selecionada."
          : "Mais de uma aba do arquivo cobre a data de referência selecionada — período ambíguo.";
      return { status: "erro", mensagem: `Arquivo não aprovado. ${motivo}` };
    }
    const abaEscolhida = resolucao.resultado.aba;
    const linhasAba = planilha.sheets[abaEscolhida.nomeAba] ?? [];
    const cabecalhoAba = linhasAba[3] ?? [];
    const linhasDados = linhasAba.slice(4);
    parseResult = parseQuebraCaixa(cabecalhoAba, linhasDados);
    fonteQuebraCaixa = {
      arquivoNome: file.name,
      nomeAba: abaEscolhida.nomeAba,
      periodoInicio: abaEscolhida.periodoInicio,
      periodoFim: abaEscolhida.periodoFim,
    };
  } else if (id === "conferencia") {
    const abasBrutas: AbaConferenciaBruta[] = Object.entries(planilha.sheets).map(([nomeAba, linhas]) => ({
      nomeAba,
      celulasLinhaDeDatas: (linhas[5] ?? []).slice(3), // linha 6 (índice 5), colunas de data a partir da 4ª
    }));
    const resolucao = resolverAbaConferenciaPorData(dataReferencia, abasBrutas);
    if (!resolucao.resultado.ok) {
      const motivo =
        resolucao.resultado.erro === "NENHUMA_ABA_CORRESPONDE"
          ? "Nenhuma aba do arquivo cobre a data de referência selecionada."
          : "Mais de uma aba do arquivo cobre a data de referência selecionada — período ambíguo.";
      return { status: "erro", mensagem: `Arquivo não aprovado. ${motivo}` };
    }
    const abaEscolhida = resolucao.resultado.aba;
    const linhasAba = planilha.sheets[abaEscolhida.nomeAba] ?? [];
    const linhaCompleta = linhasAba[5] ?? [];
    const linhasDados = linhasAba.slice(6);
    parseResult = parseConferencia(linhaCompleta, linhasDados, abaEscolhida.id);
    fonteConferencia = {
      arquivoNome: file.name,
      nomeAba: abaEscolhida.nomeAba,
      periodoInicio: abaEscolhida.periodoInicio,
      periodoFim: abaEscolhida.periodoFim,
    };
  } else {
    const cabecalho = planilha.sheets[planilha.primeiraAba]?.[0] ?? [];
    const linhas = (planilha.sheets[planilha.primeiraAba] ?? []).slice(1);

    if (info.colunasObrigatorias) {
      const faltando = validarColunas(cabecalho, info.colunasObrigatorias);
      if (faltando.length > 0) {
        return {
          status: "erro",
          mensagem: `Arquivo não aprovado. Campo(s) obrigatório(s) não encontrado(s) na planilha "${planilha.primeiraAba}": ${faltando.join(", ")}.`,
        };
      }
    }

    parseResult = executarParser(id, cabecalho, linhas);
  }

  if (parseResult.registros.length === 0) {
    return { status: "erro", mensagem: `Arquivo não aprovado. ${MENSAGEM_ZERO_REGISTROS[id]}` };
  }

  const datasRegistros = parseResult.registros.map((r) => r.data.getTime());
  const periodoArquivoInicio = new Date(Math.min(...datasRegistros));
  const periodoArquivoFim = new Date(Math.max(...datasRegistros));

  // Lote inicial (Visão Geral) com persistência real no Postgres — ver
  // lib/db/persistencia.ts. A Server Action decide, DO LADO DO SERVIDOR,
  // se há DATABASE_URL configurada (checar `process.env` aqui, no client
  // component, é sempre `undefined` mesmo com banco configurado no
  // servidor — bug real encontrado e corrigido nesta etapa). Sem banco,
  // a action retorna `null` e caímos no fluxo em memória (inalterado).
  try {
    const contagens = await persistirBaseNoBanco(id, parseResult.registros, fonteConferencia, fonteQuebraCaixa);
    if (contagens) {
      const novoEstado = aplicarGravacao(info.tipoBase, parseResult.registros, estadoAnterior);
      return {
        status: "sucesso",
        mensagem: "Base atualizada com sucesso.",
        inseridos: contagens.inseridos,
        atualizados: contagens.atualizados,
        totalFinal: contagens.totalFinal,
        novoEstado,
        persistidoNoBanco: true,
        periodoArquivoInicio,
        periodoArquivoFim,
        rejeitados: parseResult.rejeitados.length,
      };
    }
  } catch (err) {
    return {
      status: "erro",
      mensagem: `Falha ao gravar no banco de dados. ${err instanceof Error ? err.message : "Erro desconhecido."}`,
    };
  }

  const simulacao = simularGravacao(info.tipoBase, parseResult.registros, estadoAnterior);
  const novoEstado = aplicarGravacao(info.tipoBase, parseResult.registros, estadoAnterior);

  return {
    status: "sucesso",
    mensagem: "Base atualizada com sucesso.",
    inseridos: simulacao.inseridos,
    atualizados: simulacao.atualizados,
    totalFinal: simulacao.totalFinal,
    novoEstado,
    persistidoNoBanco: false,
    periodoArquivoInicio,
    periodoArquivoFim,
    rejeitados: parseResult.rejeitados.length,
  };
}
