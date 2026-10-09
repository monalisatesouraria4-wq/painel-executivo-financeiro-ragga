import type { RegistroBase } from "./tipos";
import { localizarColuna } from "./localizarColuna";

/**
 * Conferência de segurança da importação de PDV × Maquininha (módulo PURO — sem banco, sem leitura de arquivo).
 * Existe porque uma extração do Power BI chegou com o cabeçalho `Tipo_Pagamento` no lugar de `Forma de Pag.`: sem a
 * coluna de forma, as linhas ficaram com forma vazia, a regra de chave (loja + data + forma) as colapsou e o banco
 * recebeu valores parciais. Aqui ficam as três travas que impedem isso de se repetir:
 *   1. `validarCabecalhoPdv`  — TODAS as colunas obrigatórias presentes (aceita os dois nomes da coluna de forma);
 *   2. `conferirLotePdv`      — duplicidade de chave e forma vazia no lote ANTES de gravar, com totais do arquivo;
 *   3. `conferirGravacaoPdv`  — o que ficou no banco para as chaves do lote é IGUAL ao lote (contagem e valores).
 * Nenhuma regra de negócio muda: diferença continua sendo Maquininha − PDV; célula de Maquininha em branco continua
 * sendo lida como 0 (o `Diferença` da própria fonte já a trata assim) e é apenas CONTADA aqui, nunca escondida.
 */

/** Nomes aceitos para a coluna de forma de pagamento: layout antigo ("Forma de Pag.") e novo ("Tipo_Pagamento"). */
export const NOMES_COLUNA_FORMA_PDV = ["FORMA DE PAG", "TIPO_PAGAMENTO", "TIPO PAGAMENTO"] as const;

/** Índice da coluna de forma de pagamento (qualquer um dos nomes aceitos) ou -1. */
export function localizarColunaFormaPdv(cabecalho: unknown[]): number {
  for (const nome of NOMES_COLUNA_FORMA_PDV) {
    const i = localizarColuna(cabecalho, nome);
    if (i !== -1) return i;
  }
  return -1;
}

const COLUNAS_OBRIGATORIAS_PDV: { rotulo: string; buscar: (cab: unknown[]) => number }[] = [
  { rotulo: "Loja", buscar: (c) => localizarColuna(c, "LOJA") },
  { rotulo: "Data", buscar: (c) => localizarColuna(c, "DATA") },
  { rotulo: "Forma de Pag. (ou Tipo_Pagamento)", buscar: localizarColunaFormaPdv },
  { rotulo: "Venda (PDV)", buscar: (c) => localizarColuna(c, "VENDA") },
  { rotulo: "Total Maq.", buscar: (c) => localizarColuna(c, "TOTAL MAQ") },
  { rotulo: "Diferença", buscar: (c) => localizarColuna(c, "DIFEREN") },
];

export interface ResultadoCabecalhoPdv {
  ok: boolean;
  /** Rótulos das colunas obrigatórias NÃO encontradas. */
  faltando: string[];
  /** Layout detectado para a coluna de forma: "antigo" (Forma de Pag.), "novo" (Tipo_Pagamento) ou `null`. */
  layoutForma: "antigo" | "novo" | null;
}

export function validarCabecalhoPdv(cabecalho: unknown[]): ResultadoCabecalhoPdv {
  const faltando = COLUNAS_OBRIGATORIAS_PDV.filter((c) => c.buscar(cabecalho) === -1).map((c) => c.rotulo);
  const iForma = localizarColunaFormaPdv(cabecalho);
  const layoutForma = iForma === -1 ? null : localizarColuna(cabecalho, "FORMA DE PAG") !== -1 ? "antigo" : "novo";
  return { ok: faltando.length === 0, faltando, layoutForma };
}

// ───────────── conferência do lote (antes de gravar) ─────────────

const arred = (v: number) => Math.round(v * 100) / 100;
const dia = (d: Date) => d.toISOString().slice(0, 10);
export const chavePdv = (r: Pick<RegistroBase, "unidade" | "data" | "extras">) => `${r.unidade}|${dia(r.data)}|${r.extras.forma_pagamento ?? ""}`;

export interface ConferenciaLotePdv {
  linhas: number;
  chavesUnicas: number;
  /** Chaves (loja+data+forma) que aparecem em mais de uma linha — a gravação ficaria só com a última. */
  colisoes: number;
  formasVazias: number;
  totalPdv: number;
  totalMaquininha: number;
  /** Maquininha − PDV (regra existente). */
  diferenca: number;
  /** Linhas cuja célula de Maquininha estava em branco (lida como 0) — informativo. */
  maquininhaEmBranco: number;
  periodo: { inicio: string; fim: string } | null;
  porForma: { forma: string; linhas: number; pdv: number; maquininha: number }[];
  /** Motivos que IMPEDEM a gravação (lista vazia = pode gravar). */
  bloqueios: string[];
}

export function conferirLotePdv(registros: RegistroBase[], maquininhaEmBranco = 0): ConferenciaLotePdv {
  const porChave = new Map<string, number>();
  const porForma = new Map<string, { linhas: number; pdv: number; maquininha: number }>();
  let pdv = 0;
  let maq = 0;
  let formasVazias = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const r of registros) {
    const k = chavePdv(r);
    porChave.set(k, (porChave.get(k) ?? 0) + 1);
    const forma = r.extras.forma_pagamento ?? "";
    if (forma === "") formasVazias += 1;
    const m = Number(r.extras.valorMaquininha ?? 0);
    pdv += r.valor;
    maq += m;
    const f = porForma.get(forma) ?? { linhas: 0, pdv: 0, maquininha: 0 };
    f.linhas += 1;
    f.pdv += r.valor;
    f.maquininha += m;
    porForma.set(forma, f);
    min = Math.min(min, r.data.getTime());
    max = Math.max(max, r.data.getTime());
  }
  const colisoes = [...porChave.values()].filter((n) => n > 1).length;
  const bloqueios: string[] = [];
  if (registros.length === 0) bloqueios.push("O lote não tem nenhuma linha válida.");
  if (formasVazias > 0) bloqueios.push(`${formasVazias} linha(s) com forma de pagamento vazia (a chave loja+data+forma colapsaria linhas diferentes).`);
  if (colisoes > 0) bloqueios.push(`${colisoes} chave(s) loja+data+forma repetida(s): a gravação manteria só uma linha por chave e perderia valores.`);
  return {
    linhas: registros.length,
    chavesUnicas: porChave.size,
    colisoes,
    formasVazias,
    totalPdv: arred(pdv),
    totalMaquininha: arred(maq),
    diferenca: arred(maq - pdv),
    maquininhaEmBranco,
    periodo: registros.length ? { inicio: dia(new Date(min)), fim: dia(new Date(max)) } : null,
    porForma: [...porForma.entries()].map(([forma, v]) => ({ forma, linhas: v.linhas, pdv: arred(v.pdv), maquininha: arred(v.maquininha) })).sort((a, b) => a.forma.localeCompare(b.forma)),
    bloqueios,
  };
}

// ───────────── conferência da gravação (depois de gravar) ─────────────

export interface LinhaBancoPdv {
  chave: string;
  pdv: number;
  maquininha: number;
}

export interface ConferenciaGravacaoPdv {
  ok: boolean;
  esperadas: number;
  encontradas: number;
  /** Chaves do lote que NÃO estão no banco. */
  ausentes: string[];
  /** Chaves cujo valor no banco difere do lote. */
  divergentes: { chave: string; lote: { pdv: number; maquininha: number }; banco: { pdv: number; maquininha: number } }[];
  totalLote: { pdv: number; maquininha: number };
  totalBanco: { pdv: number; maquininha: number };
}

/** Compara o lote com o que ficou no banco para AS MESMAS chaves (não olha chaves de outras cargas). */
export function conferirGravacaoPdv(registros: RegistroBase[], banco: LinhaBancoPdv[], tolerancia = 0.005): ConferenciaGravacaoPdv {
  const lote = new Map<string, { pdv: number; maquininha: number }>();
  for (const r of registros) lote.set(chavePdv(r), { pdv: r.valor, maquininha: Number(r.extras.valorMaquininha ?? 0) });
  const bd = new Map(banco.map((b) => [b.chave, b]));
  const ausentes: string[] = [];
  const divergentes: ConferenciaGravacaoPdv["divergentes"] = [];
  let encontradas = 0;
  let tLp = 0, tLm = 0, tBp = 0, tBm = 0;
  for (const [chave, v] of lote) {
    tLp += v.pdv;
    tLm += v.maquininha;
    const b = bd.get(chave);
    if (!b) {
      ausentes.push(chave);
      continue;
    }
    encontradas += 1;
    tBp += b.pdv;
    tBm += b.maquininha;
    if (Math.abs(b.pdv - v.pdv) > tolerancia || Math.abs(b.maquininha - v.maquininha) > tolerancia) {
      divergentes.push({ chave, lote: v, banco: { pdv: b.pdv, maquininha: b.maquininha } });
    }
  }
  return {
    ok: ausentes.length === 0 && divergentes.length === 0,
    esperadas: lote.size,
    encontradas,
    ausentes,
    divergentes,
    totalLote: { pdv: arred(tLp), maquininha: arred(tLm) },
    totalBanco: { pdv: arred(tBp), maquininha: arred(tBm) },
  };
}
