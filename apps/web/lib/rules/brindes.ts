/**
 * Classificação de Brindes em CONTROLÁVEIS × NÃO CONTROLÁVEIS (regra de
 * negócio da Visão Geral — a criticidade/semáforo de Brindes é calculada
 * só sobre os controláveis; os não controláveis continuam na base e no
 * detalhamento).
 *
 * A classificação usa a coluna `brindes.motivo` (o motivo principal, o
 * mesmo agrupamento já usado em Indicadores):
 *
 * NÃO CONTROLÁVEIS
 *  - "BRINDE ANIVERSARIANTE"        → Aniversariante
 *  - "BRINDE CONSUMO FUNCIONARIOS"  → Consumo Funcionários
 *  - qualquer registro cujo motivo OU submotivo (`motivo2`) seja
 *    "Desconto Empresas", mesmo sob "BRINDE PRESENTE"/"TAXA EXTRA"
 *    → Empresas Parceiras (precede os demais critérios)
 *  - qualquer motivo que NÃO começa com "BRINDE" (nome de empresa
 *    parceira, ex.: TATA CONSULTANCY SERVICES, BANKME S/A, VECTRA,
 *    PARCERIA VIZINHOS)     → Empresas Parceiras (Desconto Empresas)
 *
 * CONTROLÁVEIS: todos os demais "BRINDE ..." (Presente, Taxa Extra e
 * outros motivos operacionais existentes).
 *
 * Os thresholds (`FAIXAS_BRINDES`) NÃO são alterados — só muda a base do
 * numerador do percentual.
 */

export interface ItemComposicaoBrinde {
  rotulo: string;
  valor: number;
}

export interface BrindesDetalhe {
  total: number;
  controlaveis: number;
  naoControlaveis: number;
  composicaoControlaveis: ItemComposicaoBrinde[];
  composicaoNaoControlaveis: ItemComposicaoBrinde[];
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

function titulo(texto: string): string {
  return texto
    .toLowerCase()
    .split(/\s+/)
    .map((p) => (p.length > 0 ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

export interface ClassificacaoBrinde {
  controlavel: boolean;
  rotulo: string;
}

/** "Desconto Empresas" (inclui a grafia "DESSCONTO" presente na base). */
const REGEX_DESCONTO_EMPRESAS = /DES+CONTO\s+EMPRESAS?/;

export function classificarBrinde(motivo: string, motivo2 = ""): ClassificacaoBrinde {
  const m = normalizar(motivo);
  // Desconto Empresas é NÃO controlável independentemente do motivo principal.
  if (REGEX_DESCONTO_EMPRESAS.test(m) || REGEX_DESCONTO_EMPRESAS.test(normalizar(motivo2))) {
    return { controlavel: false, rotulo: "Empresas Parceiras" };
  }
  if (m === "BRINDE ANIVERSARIANTE") return { controlavel: false, rotulo: "Aniversariante" };
  if (m === "BRINDE CONSUMO FUNCIONARIOS") return { controlavel: false, rotulo: "Consumo Funcionários" };
  if (!m.startsWith("BRINDE")) return { controlavel: false, rotulo: "Empresas Parceiras" };
  const semPrefixo = m.replace(/^BRINDE\s*/, "");
  return { controlavel: true, rotulo: semPrefixo ? titulo(semPrefixo) : "Outros" };
}

/** Agrega linhas {motivo, valor} em total / controláveis / não controláveis + composição por rótulo. */
export function resumirBrindes(linhas: { motivo: string; motivo2?: string; valor: number }[]): BrindesDetalhe {
  const ctrl = new Map<string, number>();
  const naoCtrl = new Map<string, number>();
  let controlaveis = 0;
  let naoControlaveis = 0;
  for (const l of linhas) {
    const c = classificarBrinde(l.motivo, l.motivo2);
    const alvo = c.controlavel ? ctrl : naoCtrl;
    alvo.set(c.rotulo, (alvo.get(c.rotulo) ?? 0) + l.valor);
    if (c.controlavel) controlaveis += l.valor;
    else naoControlaveis += l.valor;
  }
  const lista = (m: Map<string, number>) =>
    [...m.entries()].map(([rotulo, valor]) => ({ rotulo, valor })).sort((a, b) => b.valor - a.valor);
  return {
    total: controlaveis + naoControlaveis,
    controlaveis,
    naoControlaveis,
    composicaoControlaveis: lista(ctrl),
    composicaoNaoControlaveis: lista(naoCtrl),
  };
}
