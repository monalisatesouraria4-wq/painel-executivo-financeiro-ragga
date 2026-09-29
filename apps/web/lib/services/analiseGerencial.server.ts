import { eq, sql } from "drizzle-orm";
import type { CodigoUnidade } from "@painel/shared";
import { dataDMenos1, dataDMenos2 } from "@/lib/rules/datas";
import { getDb } from "@/lib/db/client";
import { unidades, brindes, cancelamentoSalao, cancelamentoDelivery, compraDireta } from "@/lib/db/schema";
import { buscarIndicador } from "@/lib/services/indicadores.server";
import { buscarControlesCaixa } from "@/lib/services/controlesCaixa";
import type { FonteIndicador, IndicadorData } from "@/lib/services/indicadores";
import { buscarOrientacao, buscarOrientacaoEntry } from "./analiseGerencial";
import type { AnaliseGerencialData, AtencaoLinha, ImpactoLinha, EvolucaoLinha, ComposicaoGrupo, OrientacaoLinha } from "./analiseGerencial";

const formatadorDataUTC = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Mesma tolerância já usada em `components/controlesCaixa/PdvMaquininhaTab.tsx` — não é uma regra nova. */
const TOLERANCIA_DIFERENCA_ZERO_PDV = 0.005;

const FONTES: { fonte: FonteIndicador; label: string }[] = [
  { fonte: "brindes", label: "Brindes" },
  { fonte: "cancelamentoSalao", label: "Cancelamento Salão" },
  { fonte: "cancelamentoDelivery", label: "Cancelamento Delivery" },
  { fonte: "compraDireta", label: "Retirada Compra Direta" },
];

const TABELA_POR_FONTE = { brindes, cancelamentoSalao, cancelamentoDelivery, compraDireta } as const;

function subtrairDias(data: Date, dias: number): Date {
  const d = new Date(data.getTime());
  d.setUTCDate(d.getUTCDate() - dias);
  return d;
}

/** Quebra loja × motivo na mesma janela D-1 já usada por `buscarIndicador` — mesma tabela/coluna, sem regra nova. */
async function buscarPorLojaEMotivo(
  fonte: FonteIndicador,
  data: Date
): Promise<{ unidade: CodigoUnidade; motivo: string; valor: number }[]> {
  const db = getDb();
  const tabela = TABELA_POR_FONTE[fonte];
  const rows = await db
    .select({ codigo: unidades.codigo, motivo: tabela.motivo, total: sql<string>`sum(${tabela.valor})` })
    .from(tabela)
    .innerJoin(unidades, eq(tabela.unidadeId, unidades.id))
    .where(eq(tabela.data, data))
    .groupBy(unidades.codigo, tabela.motivo);
  return rows.map((r) => ({ unidade: r.codigo as CodigoUnidade, motivo: r.motivo, valor: Number(r.total) }));
}

export async function buscarAnaliseGerencial(dataReferencia: Date): Promise<AnaliseGerencialData> {
  const conectado = Boolean(process.env.DATABASE_URL);

  const vazio: AnaliseGerencialData = {
    conectado,
    disponivel: false,
    dataReferencia,
    dataAnteriorLabel: "",
    atencao: [],
    impacto: [],
    evolucao: [],
    composicao: [],
    orientacao: [],
  };

  if (!conectado) return vazio;

  const dataAnteriorRef = dataDMenos1(dataReferencia); // desloca a janela D-1 mais um dia p/ trás
  const dataSemanaAnterior = subtrairDias(dataReferencia, 7);

  const [atualPorFonte, anteriorPorFonte, controlesAtual, controlesAnterior] = await Promise.all([
    Promise.all(FONTES.map((f) => buscarIndicador(f.fonte, dataReferencia))),
    Promise.all(FONTES.map((f) => buscarIndicador(f.fonte, dataAnteriorRef))),
    buscarControlesCaixa(dataReferencia),
    buscarControlesCaixa(dataSemanaAnterior),
  ]);

  const atual: Record<FonteIndicador, IndicadorData> = Object.fromEntries(
    FONTES.map((f, i) => [f.fonte, atualPorFonte[i]])
  ) as Record<FonteIndicador, IndicadorData>;
  const anterior: Record<FonteIndicador, IndicadorData> = Object.fromEntries(
    FONTES.map((f, i) => [f.fonte, anteriorPorFonte[i]])
  ) as Record<FonteIndicador, IndicadorData>;

  // --- 1. ATENÇÃO / CRÍTICO ---
  const atencao: AtencaoLinha[] = [];
  for (const { fonte, label } of FONTES) {
    for (const linha of atual[fonte].porFilial) {
      if (linha.semaforo === "amarelo" || linha.semaforo === "vermelho") {
        atencao.push({
          indicador: label,
          unidade: linha.unidade,
          valor: linha.valor,
          percentualFaturamento: linha.percentualFaturamento,
          situacao: linha.semaforo === "vermelho" ? "Crítico" : "Atenção",
        });
      }
    }
  }
  if (controlesAtual.troco.disponivel) {
    for (const linha of controlesAtual.troco.linhas) {
      const divergentes = linha.caixas.filter((c) => c.status === "Divergência");
      if (divergentes.length > 0) {
        atencao.push({
          indicador: "Troco",
          unidade: linha.unidade,
          valor: divergentes.reduce((s, c) => s + Math.abs(c.diferenca), 0),
          percentualFaturamento: null,
          situacao: `${divergentes.length} divergência(s)`,
        });
      }
    }
  }
  if (controlesAtual.pdvMaquininha.disponivel) {
    for (const linha of controlesAtual.pdvMaquininha.linhas) {
      if (Math.abs(linha.diferenca) > TOLERANCIA_DIFERENCA_ZERO_PDV) {
        atencao.push({
          indicador: "PDV × Adquirente",
          unidade: linha.unidade,
          valor: linha.diferenca,
          percentualFaturamento: null,
          situacao: "Divergente",
        });
      }
    }
  }

  // --- 2. MAIOR IMPACTO (top 3 lojas + top motivo por indicador, dados reais) ---
  const impacto: ImpactoLinha[] = [];
  for (const { fonte, label } of FONTES) {
    const topLojas = [...atual[fonte].porFilial].sort((a, b) => b.valor - a.valor).slice(0, 3);
    for (const l of topLojas) impacto.push({ indicador: label, tipo: "loja", chave: l.unidade, valor: l.valor });
    const topMotivo = [...atual[fonte].porMotivo].sort((a, b) => b.valor - a.valor)[0];
    if (topMotivo) impacto.push({ indicador: label, tipo: "motivo", chave: topMotivo.motivo, valor: topMotivo.valor });
  }
  if (controlesAtual.troco.disponivel) {
    const porLoja = controlesAtual.troco.linhas
      .map((l) => ({
        unidade: l.unidade,
        valor: l.caixas.filter((c) => c.status === "Divergência").reduce((s, c) => s + Math.abs(c.diferenca), 0),
      }))
      .filter((l) => l.valor > 0)
      .sort((a, b) => b.valor - a.valor)[0];
    if (porLoja) impacto.push({ indicador: "Troco", tipo: "loja", chave: porLoja.unidade, valor: porLoja.valor });
  }
  if (controlesAtual.pdvMaquininha.disponivel && controlesAtual.pdvMaquininha.linhas.length > 0) {
    const maiorDiferenca = [...controlesAtual.pdvMaquininha.linhas].sort(
      (a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca)
    )[0];
    impacto.push({ indicador: "PDV × Adquirente", tipo: "loja", chave: maiorDiferenca.unidade, valor: maiorDiferenca.diferenca });
  }

  // --- 3. EVOLUÇÃO (atual vs período anterior disponível — sem qualificar bom/ruim) ---
  const evolucao: EvolucaoLinha[] = [];
  function pushEvolucao(indicador: string, atualValor: number | null, anteriorValor: number | null) {
    const delta = atualValor !== null && anteriorValor !== null ? atualValor - anteriorValor : null;
    const deltaPercentual =
      delta !== null && anteriorValor !== null && anteriorValor !== 0 ? (delta / Math.abs(anteriorValor)) * 100 : null;
    evolucao.push({ indicador, atual: atualValor, anterior: anteriorValor, delta, deltaPercentual });
  }
  pushEvolucao("Faturamento (base D-1)", atual.brindes.faturamentoPeriodo, anterior.brindes.faturamentoPeriodo);
  for (const { fonte, label } of FONTES) {
    pushEvolucao(label, atual[fonte].disponivel ? atual[fonte].totalIndicador : null, anterior[fonte].disponivel ? anterior[fonte].totalIndicador : null);
  }
  pushEvolucao(
    "Troco — divergências (rede)",
    controlesAtual.troco.disponivel ? controlesAtual.troco.divergencias : null,
    controlesAnterior.troco.disponivel ? controlesAnterior.troco.divergencias : null
  );
  pushEvolucao(
    "PDV × Adquirente — diferença (rede)",
    controlesAtual.pdvMaquininha.disponivel ? controlesAtual.pdvMaquininha.diferencaRede : null,
    controlesAnterior.pdvMaquininha.disponivel ? controlesAnterior.pdvMaquininha.diferencaRede : null
  );

  // --- 4. COMPOSIÇÃO / CAUSA (motivos reais da base; PDV usa a classificação já existente) ---
  const composicao: ComposicaoGrupo[] = [];
  for (const { fonte, label } of FONTES) {
    if (atual[fonte].disponivel && atual[fonte].porMotivo.length > 0) {
      composicao.push({
        indicador: label,
        itens: atual[fonte].porMotivo.map((m) => ({
          motivo: m.motivo,
          valor: m.valor,
          percentualFaturamento: m.percentualFaturamento,
          controlavel: buscarOrientacaoEntry(label, m.motivo)?.controlavel,
        })),
      });
    }
  }
  if (controlesAtual.troco.disponivel) {
    let negativa = 0;
    let positiva = 0;
    for (const linha of controlesAtual.troco.linhas) {
      for (const caixa of linha.caixas) {
        if (caixa.status !== "Divergência") continue;
        if (caixa.diferenca < 0) negativa += Math.abs(caixa.diferenca);
        else positiva += caixa.diferenca;
      }
    }
    if (negativa > 0 || positiva > 0) {
      composicao.push({
        indicador: "Troco",
        itens: [
          ...(negativa > 0 ? [{ motivo: "Divergência negativa", valor: negativa, percentualFaturamento: null }] : []),
          ...(positiva > 0 ? [{ motivo: "Divergência positiva / Sobra", valor: positiva, percentualFaturamento: null }] : []),
        ],
      });
    }
  }
  if (controlesAtual.pdvMaquininha.disponivel && controlesAtual.pdvMaquininha.linhas.length > 0) {
    const divergentes = controlesAtual.pdvMaquininha.linhas.filter((l) => Math.abs(l.diferenca) > TOLERANCIA_DIFERENCA_ZERO_PDV).length;
    const ok = controlesAtual.pdvMaquininha.linhas.length - divergentes;
    composicao.push({
      indicador: "PDV × Adquirente (classificação já existente, tolerância 0,005)",
      itens: [
        { motivo: "Lojas OK", valor: ok, percentualFaturamento: null },
        { motivo: "Lojas divergentes", valor: divergentes, percentualFaturamento: null },
      ],
    });
  }

  // --- 5. ORIENTAÇÃO (indicador → loja → motivo → valor → orientação, só para ocorrências
  // já em Atenção/Crítico; regra sem entrada no catálogo mostra "Sem orientação cadastrada") ---
  const orientacao: OrientacaoLinha[] = [];
  const lojasEmAtencaoPorFonte = new Map<FonteIndicador, Set<CodigoUnidade>>();
  for (const { fonte } of FONTES) {
    lojasEmAtencaoPorFonte.set(
      fonte,
      new Set(atual[fonte].porFilial.filter((l) => l.semaforo === "amarelo" || l.semaforo === "vermelho").map((l) => l.unidade))
    );
  }
  // Janela real de cada indicador — usada tanto na consulta quanto no
  // `dataOcorrencia` de cada linha de Orientação (nunca uma data inventada).
  const dataOcorrenciaD1 = dataDMenos1(dataReferencia);
  const dataOcorrenciaD2 = dataDMenos2(dataReferencia);

  const quebrasPorLojaEMotivo = await Promise.all(FONTES.map((f) => buscarPorLojaEMotivo(f.fonte, dataOcorrenciaD1)));
  FONTES.forEach(({ fonte, label }, i) => {
    const lojasEmAtencao = lojasEmAtencaoPorFonte.get(fonte)!;
    const faturamentoPorLoja = new Map(atual[fonte].porFilial.map((l) => [l.unidade, l.faturamento]));
    for (const linha of quebrasPorLojaEMotivo[i]) {
      if (!lojasEmAtencao.has(linha.unidade)) continue;
      const entry = buscarOrientacaoEntry(label, linha.motivo);
      const fatLoja = faturamentoPorLoja.get(linha.unidade) ?? 0;
      orientacao.push({
        indicador: label,
        unidade: linha.unidade,
        motivo: linha.motivo,
        valor: linha.valor,
        percentualFaturamento: fatLoja > 0 ? (linha.valor / fatLoja) * 100 : null,
        orientacao: entry?.texto ?? "Sem orientação cadastrada",
        controlavel: entry?.controlavel,
        naoNegativo: entry?.naoNegativo,
        dataOcorrencia: dataOcorrenciaD1,
      });
    }
  });
  if (controlesAtual.troco.disponivel) {
    // Uma linha por caixa divergente (não agregada por loja): é a única
    // forma de anexar a data REAL da ocorrência (`caixa.data`) sem
    // inventar uma data única para a semana inteira.
    for (const linha of controlesAtual.troco.linhas) {
      for (const caixa of linha.caixas) {
        if (caixa.status !== "Divergência") continue;
        const negativa = caixa.diferenca < 0;
        const motivo = negativa ? "Divergência negativa" : "Divergência positiva / Sobra";
        orientacao.push({
          indicador: "Troco",
          unidade: linha.unidade,
          motivo,
          valor: Math.abs(caixa.diferenca),
          percentualFaturamento: null,
          orientacao: buscarOrientacao("Troco", motivo),
          dataOcorrencia: caixa.data,
        });
      }
    }
  }
  if (controlesAtual.pdvMaquininha.disponivel) {
    for (const linha of controlesAtual.pdvMaquininha.linhas) {
      if (Math.abs(linha.diferenca) <= TOLERANCIA_DIFERENCA_ZERO_PDV) continue;
      orientacao.push({
        indicador: "PDV × Adquirente",
        unidade: linha.unidade,
        motivo: "Divergente",
        valor: linha.diferenca,
        percentualFaturamento: null,
        orientacao: buscarOrientacao("PDV × Adquirente", "Divergente"),
        dataOcorrencia: dataOcorrenciaD2,
      });
    }
  }

  const disponivel = atencao.length > 0 || impacto.length > 0 || composicao.length > 0 || evolucao.some((e) => e.atual !== null);

  return {
    conectado,
    disponivel,
    dataReferencia,
    dataAnteriorLabel: `D-1 de ${formatadorDataUTC.format(dataAnteriorRef)} (Troco/PDV: semana/D-2 de ${formatadorDataUTC.format(dataSemanaAnterior)})`,
    atencao,
    impacto,
    evolucao,
    composicao,
    orientacao,
  };
}
