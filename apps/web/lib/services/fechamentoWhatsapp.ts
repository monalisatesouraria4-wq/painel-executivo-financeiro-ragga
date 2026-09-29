/**
 * Camada de serviço de "Fechamento WhatsApp". Espelha
 * `computeWhatsappReport`/`buildWhatsappText`/`buildImageHtml` do legado
 * (linhas 3929-4179) — auditoria funcional confirmada por código-fonte.
 *
 * Todos os indicadores desta tela usam DATA LITERAL do dia selecionado
 * (sem D-1/D-2), confirmado explicitamente no comentário do legado
 * (linha 3939) — EXCETO Troco, que usa a semana mais próxima ≤ a data
 * selecionada (`TROCO_DATAS`, regra já existente, preservada).
 *
 * Campos calculados no legado mas NÃO usados no texto nem na imagem
 * (mantidos aqui só para paridade de tipo, não exibidos na UI):
 * `retDepTotal`/`retDepPorLoja` (Retirada Depósito) e
 * `unidadesOrdenadas`. PDV × Maquininha e Conferência NÃO entram nesta
 * tela — confirmado, ausentes de `computeWhatsappReport`.
 *
 * Sem DATABASE_URL: `disponivel: false`, `report: null` — nenhum valor
 * inventado. `buildWhatsappText`/`buildResumo` são funções puras,
 * testáveis independente de conexão (porta fiel do template do legado).
 */

export interface FormaPagamentoBuckets {
  credito: number;
  debito: number;
  pix: number;
  voucher: number;
  vendaAPrazo: number;
  online: number;
  dinheiro: number;
  outros: number;
}

export interface WhatsappReportData {
  dateStr: string;
  faturamentoTotal: number;
  formaBuckets: FormaPagamentoBuckets;
  brindeTotal: number;
  brindeMotivoMap: Record<string, number>;
  cancSalaoTotal: number;
  cancSalaoMotivoMap: Record<string, number>;
  cancDeliveryTotal: number;
  cancDeliveryMotivoMap: Record<string, number>;
  cancTotal: number; // salão + delivery, só para o cálculo do resumo
  compraDiretaTotal: number;
  compraDiretaMotivoMap: Record<string, number>;
  quebraTotal: number;
  fechAbertos: number;
  fechFechados: number;
  fechConciliados: number;
}

export interface FechamentoWhatsappData {
  conectado: boolean;
  disponivel: boolean;
  dateStr: string;
  semDados: boolean;
  report: WhatsappReportData | null;
}

/** Formas de Pagamento: fonte ainda não conectada — buckets zerados, documentado como pendência (nunca inventado). */
export const FORMA_BUCKETS_VAZIO: FormaPagamentoBuckets = {
  credito: 0,
  debito: 0,
  pix: 0,
  voucher: 0,
  vendaAPrazo: 0,
  online: 0,
  dinheiro: 0,
  outros: 0,
};

/**
 * Consulta real em `fechamentoWhatsapp.server.ts` (arquivo separado —
 * mesma fronteira "use server"/client-safe já documentada em
 * indicadores.ts/retiradaDeposito.ts).
 */

const formatadorBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatBRL(valor: number): string {
  return formatadorBRL.format(valor);
}

function listaMotivos(mapa: Record<string, number>): string {
  const entradas = Object.entries(mapa).sort((a, b) => b[1] - a[1]);
  if (entradas.length === 0) return "- Sem registros nesta data";
  return entradas.map(([motivo, valor]) => `- ${motivo}: ${formatBRL(valor)}`).join("\n");
}

/**
 * Porta fiel do cálculo do resumo final (💡) do legado (linhas 4084-4092):
 * soma "N caixa(s) ainda em aberto" se `fechAbertos>0`, e "cancelamentos
 * em X.X% do faturamento" se `cancTotal>0 && faturamentoTotal>0` e o
 * percentual for > 1%. Sem nenhuma dessas condições, retorna a frase
 * "dentro da normalidade"; com alguma, "Dia com {partes} — vale atenção."
 */
export function buildResumo(report: WhatsappReportData): string {
  const partes: string[] = [];

  if (report.fechAbertos > 0) {
    partes.push(`${report.fechAbertos} caixa(s) ainda em aberto`);
  }

  if (report.cancTotal > 0 && report.faturamentoTotal > 0) {
    const pctCanc = (report.cancTotal / report.faturamentoTotal) * 100;
    if (pctCanc > 1) {
      partes.push(`cancelamentos em ${pctCanc.toFixed(1)}% do faturamento`);
    }
  }

  if (partes.length === 0) {
    return "Dia dentro da normalidade operacional, sem apontamentos críticos.";
  }
  return `Dia com ${partes.join(" e ")} — vale atenção.`;
}

/** Porta fiel do texto copiado pelo botão "Copiar texto" (legado, `buildWhatsappText`, linhas 4024-4097). */
export function buildWhatsappText(report: WhatsappReportData): string {
  const fp = report.formaBuckets;
  const linhasForma = [
    `- Crédito: ${formatBRL(fp.credito)}`,
    `- Débito: ${formatBRL(fp.debito)}`,
    `- Pix: ${formatBRL(fp.pix)}`,
    `- Voucher: ${formatBRL(fp.voucher)}`,
    `- Venda a Prazo: ${formatBRL(fp.vendaAPrazo)}`,
    `- Online: ${formatBRL(fp.online)}`,
  ];
  if (fp.dinheiro > 0.005) linhasForma.push(`- Dinheiro: ${formatBRL(fp.dinheiro)}`);
  if (fp.outros > 0.005) linhasForma.push(`- Outros: ${formatBRL(fp.outros)}`);

  return [
    "📊 ADM/FINANCEIRO · CAIXAS (FECHAMENTO DIÁRIO) — GRUPO LONDRINO",
    `📅 ${report.dateStr}`,
    "",
    `💰 Faturamento do dia: ${formatBRL(report.faturamentoTotal)}`,
    "",
    "💳 Formas de pagamento",
    linhasForma.join("\n"),
    "",
    `🎁 Brindes do dia · ${formatBRL(report.brindeTotal)}`,
    listaMotivos(report.brindeMotivoMap),
    "",
    `❌ Cancelamento Delivery · ${formatBRL(report.cancDeliveryTotal)}`,
    listaMotivos(report.cancDeliveryMotivoMap),
    "",
    `❌ Cancelamento Salão · ${formatBRL(report.cancSalaoTotal)}`,
    listaMotivos(report.cancSalaoMotivoMap),
    "",
    `📌 Retirada Compra Direta · ${formatBRL(report.compraDiretaTotal)}`,
    listaMotivos(report.compraDiretaMotivoMap),
    "",
    "📦 Fechamento dos caixas",
    `- Caixas/movimentos abertos: ${report.fechAbertos}`,
    `- Caixas/movimentos fechados: ${report.fechFechados}`,
    `- Conciliados: ${report.fechConciliados}`,
    "",
    `💡 ${buildResumo(report)}`,
    "",
    "— Gestão Ragga · Financeiro",
  ].join("\n");
}
