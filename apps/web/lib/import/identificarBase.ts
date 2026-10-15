import { BASE_REGISTRY, buscarBaseInfo, validarColunas, type BaseId } from "@/lib/services/atualizacaoBases";

/**
 * Identificação da(s) base(s) de uma planilha enviada (usada pelo comando "atualizar base"). Função PURA: recebe o nome do
 * arquivo, os nomes das abas e o cabeçalho da primeira aba. Usa as MESMAS colunas obrigatórias da tela de Atualização de
 * Bases (`BASE_REGISTRY` / `validarColunas`) — nada de regra nova — e o nome do arquivo só desempata ou confirma.
 *
 *  - Controle de Conferência e Quebras: planilha por ciclos (abas "16.09 a 15.10" + "QUEBRA 16-09 A 15-10") → alimenta
 *    DUAS bases (Conferência e Quebra de Caixa);
 *  - demais: bases cujas colunas obrigatórias o cabeçalho contém; o nome do arquivo escolhe entre candidatas e, se aponta
 *    uma base cujas colunas faltam, o arquivo é RECUSADO (como a tela) em vez de ser importado como outra base.
 */

export type StatusIdentificacao = "ok" | "recusado" | "ambiguo" | "desconhecido";

export interface ResultadoIdentificacao {
  status: StatusIdentificacao;
  bases: BaseId[];
  motivo: string;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/** Dicas do NOME do arquivo (nunca bastam sozinhas: as colunas obrigatórias também precisam existir). */
const DICAS: { padrao: RegExp; bases: BaseId[] }[] = [
  { padrao: /CONFERENCIA|QUEBRAS?\s+DE\s+CAIXA/, bases: ["conferencia", "quebraCaixa"] },
  { padrao: /BRINDE/, bases: ["brindes"] },
  { padrao: /CANCEL\w*\s*[_ ]*SAL/, bases: ["cancelamentoSalao"] },
  { padrao: /DELIVERY/, bases: ["cancelamentoDelivery"] },
  { padrao: /COMPRA[_ ]*DIRETA/, bases: ["compraDireta"] },
  { padrao: /FECHAMENTO/, bases: ["fechamento"] },
  { padrao: /PDV|ADQUIRENTE/, bases: ["pdvMaquininha"] },
  { padrao: /DEPOSITO/, bases: ["retiradaDeposito"] },
  { padrao: /TROCO/, bases: ["troco"] },
  { padrao: /VENDAS|FATURAMENTO/, bases: ["faturamento"] },
];

const ABA_CICLO = /^\d{2}\.\d{2}\s*A\s*\d{2}\.\d{2}$/;

export function identificarBase(e: { nomeArquivo: string; abas: string[]; cabecalhoPrimeiraAba: unknown[] }): ResultadoIdentificacao {
  const abasNorm = e.abas.map((a) => semAcento(a).trim());
  if (abasNorm.some((a) => ABA_CICLO.test(a)) && abasNorm.some((a) => a.startsWith("QUEBRA"))) {
    return { status: "ok", bases: ["conferencia", "quebraCaixa"], motivo: "planilha por ciclos (abas de Conferência e de Quebra)" };
  }

  const candidatas = BASE_REGISTRY.filter((b) => b.colunasObrigatorias !== null && validarColunas(e.cabecalhoPrimeiraAba, b.colunasObrigatorias).length === 0).map((b) => b.id);
  const nome = semAcento(e.nomeArquivo);
  const dica = DICAS.find((d) => d.padrao.test(nome));

  if (dica) {
    const base = dica.bases[0];
    if (dica.bases.length > 1) {
      return { status: "recusado", bases: [], motivo: `o nome sugere ${dica.bases.join(" + ")}, mas a planilha não tem as abas de ciclo esperadas` };
    }
    if (candidatas.includes(base)) return { status: "ok", bases: [base], motivo: "nome do arquivo e colunas obrigatórias conferem" };
    const info = buscarBaseInfo(base);
    const faltando = info.colunasObrigatorias ? validarColunas(e.cabecalhoPrimeiraAba, info.colunasObrigatorias) : [];
    return { status: "recusado", bases: [], motivo: `o nome sugere ${info.nome}, mas faltam colunas obrigatórias: ${faltando.join(", ") || "(estrutura não reconhecida)"}` };
  }

  if (candidatas.length === 1) return { status: "ok", bases: candidatas, motivo: "identificada só pelas colunas obrigatórias" };
  if (candidatas.length === 0) return { status: "desconhecido", bases: [], motivo: "nenhuma base tem todas as colunas obrigatórias neste arquivo" };
  return { status: "ambiguo", bases: candidatas, motivo: `colunas compatíveis com mais de uma base (${candidatas.join(", ")}) e o nome do arquivo não desempata` };
}
