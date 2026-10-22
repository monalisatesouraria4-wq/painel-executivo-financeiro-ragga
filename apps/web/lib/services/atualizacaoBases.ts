import type { TipoBase } from "@painel/shared";
import { lerArquivoExcel } from "@/lib/import/lerArquivoExcel";
import { aplicarGravacao } from "@/lib/import/aplicarGravacao";
import { simularGravacao } from "@/lib/import/simularGravacao";
import { localizarColuna, localizarColunaExata } from "@/lib/import/localizarColuna";
import { resolverAbaConferenciaPorData, type AbaConferenciaBruta } from "@/lib/import/resolverAbaConferencia";
import { lerQuebraDaPlanilha } from "@/lib/import/quebraDaPlanilha";
import { persistirBaseNoBanco } from "@/lib/actions/persistirBase";
import { baseSnapshot } from "@/lib/import/basesSnapshot";
import { resumirClasses } from "@/lib/import/classificarRejeicoes";
import { persistirDetalhesCancelamentoSalao } from "@/lib/actions/persistirCancelamentoSalaoDetalhes";
import { parseCancelamentoSalaoDetalhe, type ResultadoParseDetalhe } from "@/lib/import/parsers/cancelamentoSalaoDetalhe";
import { parseFaturamento } from "@/lib/import/parsers/faturamento";
import { parseFechamentoCaixa } from "@/lib/import/parsers/fechamentoCaixa";
import { parsePdvMaquininha } from "@/lib/import/parsers/pdvMaquininha";
import { parseTroco } from "@/lib/import/parsers/troco";
import { parseRetiradaDeposito } from "@/lib/import/parsers/retiradaDeposito";
import { parseListaSimples, CONFIGS_LISTA_SIMPLES } from "@/lib/import/parsers/listaSimples";
import { parseConferencia } from "@/lib/import/parsers/conferencia";
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
      /** Lote parseado para a simulação/confirmação da sincronização autoritativa (bases em `BASES_SNAPSHOT`). */
      registrosSincronizacao?: RegistroBase[];
      /** SHA-256 do arquivo (entra no hash do plano). */
      arquivoSha256?: string;
      /** Só Cancelamento Salão: detalhes individuais dos estornos, a gravar (em lotes) DEPOIS da sincronização confirmada. */
      detalhesParaGravar?: import("@/lib/import/parsers/cancelamentoSalaoDetalhe").DetalheCancelamentoSalao[];
      detalhesRejeitados?: number;
      /** Período (min/max data) encontrado NO ARQUIVO enviado — item 7 da etapa de revisão. */
      periodoArquivoInicio: Date;
      periodoArquivoFim: Date;
      /** Linhas rejeitadas pelo parser (unidade não reconhecida, data/valor inválido etc.). */
      rejeitados: number;
      /** Só Cancelamento Salão: detalhe individual dos estornos (tabela adicional; o agregado acima não muda). */
      detalhes?: { inseridos: number; atualizados: number; rejeitados: number; erro?: string };
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
  let detalhesCancelamentoSalao: ResultadoParseDetalhe | undefined;

  if (id === "quebraCaixa") {
    // Cada lançamento vale pela SUA data real; o que não entra volta em `rejeitados` com motivo (nada é descartado em silêncio).
    const quebra = lerQuebraDaPlanilha(planilha.sheets, dataReferencia);
    if (!quebra.ok) {
      const motivo =
        quebra.erro === "NENHUMA_ABA_CORRESPONDE"
          ? "Nenhuma aba do arquivo cobre a data de referência selecionada."
          : "Mais de uma aba do arquivo cobre a data de referência selecionada — período ambíguo.";
      return { status: "erro", mensagem: `Arquivo não aprovado. ${motivo}` };
    }
    parseResult = quebra.parse;
    fonteQuebraCaixa = {
      arquivoNome: file.name,
      nomeAba: quebra.aba.nomeAba,
      periodoInicio: quebra.aba.periodoInicio,
      periodoFim: quebra.aba.periodoFim,
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
    if (id === "cancelamentoSalao") detalhesCancelamentoSalao = parseCancelamentoSalaoDetalhe(cabecalho, linhas);
  }

  if (parseResult.registros.length === 0) {
    return { status: "erro", mensagem: `Arquivo não aprovado. ${MENSAGEM_ZERO_REGISTROS[id]}` };
  }

  const datasRegistros = parseResult.registros.map((r) => r.data.getTime());
  const periodoArquivoInicio = new Date(Math.min(...datasRegistros));
  const periodoArquivoFim = new Date(Math.max(...datasRegistros));

  // Bases com SINCRONIZAÇÃO AUTORITATIVA: nunca gravam por aqui. Devolve a prévia (lote já validado pelo parser oficial) para a tela
  // chamar a simulação no servidor (`previsualizarSincronizacaoBase`) e, só depois da confirmação explícita, gravar.
  if (baseSnapshot(id)) {
    const comDecisao = resumirClasses(id, parseResult.rejeitados.map((r) => ({ linhaOrigem: r.linhaOrigem, motivo: r.motivo, valoresBrutos: r.valoresBrutos }))).atencao;
    if (comDecisao.length > 0) {
      return {
        status: "erro",
        mensagem: `Arquivo não aprovado. Sincronização autoritativa bloqueada: ${comDecisao.length} linha(s) rejeitada(s) com dado real (ex.: linha ${comDecisao[0].linhaOrigem}: ${comDecisao[0].motivo}). Corrija a origem; nada será gravado.`,
      };
    }
    const simulacao = simularGravacao(info.tipoBase, parseResult.registros, estadoAnterior);
    let arquivoSha256: string | undefined;
    try {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      arquivoSha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      arquivoSha256 = undefined;
    }
    return {
      status: "sucesso",
      mensagem: "Prévia da fonte oficial pronta para revisão.",
      inseridos: simulacao.inseridos,
      atualizados: simulacao.atualizados,
      totalFinal: simulacao.totalFinal,
      novoEstado: aplicarGravacao(info.tipoBase, parseResult.registros, estadoAnterior),
      persistidoNoBanco: false,
      registrosSincronizacao: parseResult.registros,
      arquivoSha256,
      ...(detalhesCancelamentoSalao ? { detalhesParaGravar: detalhesCancelamentoSalao.registros, detalhesRejeitados: detalhesCancelamentoSalao.rejeitados.length } : {}),
      periodoArquivoInicio,
      periodoArquivoFim,
      rejeitados: parseResult.rejeitados.length,
    };
  }

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
      // Cancelamento Salão: além do agregado (já gravado acima, inalterado), grava o detalhe individual dos estornos em
      // lotes (limite de corpo das Server Actions). Falha aqui NÃO desfaz o agregado — é informada em `detalhes.erro`.
      let detalhes: Extract<ResultadoImportacao, { status: "sucesso" }>["detalhes"];
      if (detalhesCancelamentoSalao) {
        try {
          let inseridosD = 0;
          let atualizadosD = 0;
          const regs = detalhesCancelamentoSalao.registros;
          for (let i = 0; i < regs.length; i += 800) {
            const r = await persistirDetalhesCancelamentoSalao(regs.slice(i, i + 800));
            inseridosD += r?.inseridos ?? 0;
            atualizadosD += r?.atualizados ?? 0;
          }
          detalhes = { inseridos: inseridosD, atualizados: atualizadosD, rejeitados: detalhesCancelamentoSalao.rejeitados.length };
        } catch (err) {
          detalhes = { inseridos: 0, atualizados: 0, rejeitados: detalhesCancelamentoSalao.rejeitados.length, erro: err instanceof Error ? err.message : "Erro desconhecido." };
        }
      }
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
        ...(detalhes ? { detalhes } : {}),
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
