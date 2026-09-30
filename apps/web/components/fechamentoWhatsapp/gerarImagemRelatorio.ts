import type { WhatsappReportData } from "@/lib/services/fechamentoWhatsapp";
import { buildResumo } from "@/lib/services/fechamentoWhatsapp";

/**
 * Geração da imagem do relatório (botão "Gerar imagem" — estava só um
 * placeholder desabilitado, `title="Geração de imagem ainda não
 * implementada"`; não havia nenhuma implementação quebrada para corrigir,
 * esta é a implementação real). Desenha diretamente em `<canvas>` (API
 * nativa do navegador, sem nenhuma dependência nova) EXATAMENTE o mesmo
 * conteúdo/valores de `buildWhatsappText` — mesma fonte de dados
 * (`WhatsappReportData`), nenhum cálculo novo, nenhuma regra de data
 * alterada. Formato vertical (pensado para WhatsApp/celular), fundo
 * branco, identidade azul do painel (`ragga-blue`/`ragga-blue-dark`).
 */

const RAGGA_BLUE = "#2b4899";
const RAGGA_BLUE_DARK = "#1f3570";
const CINZA_TEXTO = "#1f2937";
const CINZA_CLARO = "#6b7280";
const LARGURA = 900;
const PADDING_X = 48;
const LARGURA_CONTEUDO = LARGURA - PADDING_X * 2;

const formatadorBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function formatBRL(valor: number): string {
  return formatadorBRL.format(valor);
}

function linhasMotivo(mapa: Record<string, number>): string[] {
  const entradas = Object.entries(mapa).sort((a, b) => b[1] - a[1]);
  if (entradas.length === 0) return ["Sem registros nesta data"];
  return entradas.map(([motivo, valor]) => `${motivo}: ${formatBRL(valor)}`);
}

type Bloco =
  | { tipo: "espaco"; altura: number }
  | { tipo: "secao"; texto: string }
  | { tipo: "linha"; texto: string; cor?: string; negrito?: boolean; tamanho?: number }
  | { tipo: "item"; texto: string }
  | { tipo: "divisor" };

/** Quebra um texto em múltiplas linhas para caber em `larguraMax`, usando o contexto já com a fonte ativa. */
function quebrarTexto(ctx: CanvasRenderingContext2D, texto: string, larguraMax: number): string[] {
  const palavras = texto.split(" ");
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (ctx.measureText(teste).width > larguraMax && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function montarBlocos(report: WhatsappReportData, tratativas: string): Bloco[] {
  const fp = report.formaBuckets;
  const blocos: Bloco[] = [];

  blocos.push({ tipo: "secao", texto: "💰 Faturamento do dia" });
  blocos.push({ tipo: "linha", texto: formatBRL(report.faturamentoTotal), cor: RAGGA_BLUE_DARK, negrito: true, tamanho: 30 });
  blocos.push({ tipo: "espaco", altura: 20 });

  blocos.push({ tipo: "secao", texto: "💳 Formas de pagamento" });
  blocos.push({ tipo: "item", texto: `Crédito: ${formatBRL(fp.credito)}` });
  blocos.push({ tipo: "item", texto: `Débito: ${formatBRL(fp.debito)}` });
  blocos.push({ tipo: "item", texto: `Pix: ${formatBRL(fp.pix)}` });
  blocos.push({ tipo: "item", texto: `Voucher: ${formatBRL(fp.voucher)}` });
  blocos.push({ tipo: "item", texto: `Venda a Prazo: ${formatBRL(fp.vendaAPrazo)}` });
  blocos.push({ tipo: "item", texto: `Online: ${formatBRL(fp.online)}` });
  if (fp.dinheiro > 0.005) blocos.push({ tipo: "item", texto: `Dinheiro: ${formatBRL(fp.dinheiro)}` });
  if (fp.outros > 0.005) blocos.push({ tipo: "item", texto: `Outros: ${formatBRL(fp.outros)}` });
  blocos.push({ tipo: "espaco", altura: 20 });

  blocos.push({ tipo: "secao", texto: `🎁 Brindes do dia · ${formatBRL(report.brindeTotal)}` });
  for (const linha of linhasMotivo(report.brindeMotivoMap)) blocos.push({ tipo: "item", texto: linha });
  blocos.push({ tipo: "espaco", altura: 20 });

  blocos.push({ tipo: "secao", texto: `❌ Cancelamento Delivery · ${formatBRL(report.cancDeliveryTotal)}` });
  for (const linha of linhasMotivo(report.cancDeliveryMotivoMap)) blocos.push({ tipo: "item", texto: linha });
  blocos.push({ tipo: "espaco", altura: 20 });

  blocos.push({ tipo: "secao", texto: `❌ Cancelamento Salão · ${formatBRL(report.cancSalaoTotal)}` });
  for (const linha of linhasMotivo(report.cancSalaoMotivoMap)) blocos.push({ tipo: "item", texto: linha });
  blocos.push({ tipo: "espaco", altura: 20 });

  blocos.push({ tipo: "secao", texto: `📌 Retirada Compra Direta · ${formatBRL(report.compraDiretaTotal)}` });
  for (const linha of linhasMotivo(report.compraDiretaMotivoMap)) blocos.push({ tipo: "item", texto: linha });
  blocos.push({ tipo: "espaco", altura: 20 });

  blocos.push({ tipo: "secao", texto: "📦 Fechamento dos caixas" });
  blocos.push({ tipo: "item", texto: `Caixas/movimentos abertos: ${report.fechAbertos}` });
  blocos.push({ tipo: "item", texto: `Caixas/movimentos fechados: ${report.fechFechados}` });
  blocos.push({ tipo: "item", texto: `Conciliados: ${report.fechConciliados}` });
  blocos.push({ tipo: "espaco", altura: 20 });

  blocos.push({ tipo: "divisor" });
  blocos.push({ tipo: "linha", texto: `💡 ${buildResumo(report)}`, cor: CINZA_TEXTO });

  // Tratativas — só entra na imagem quando preenchida (item explícito do pedido).
  if (tratativas.trim().length > 0) {
    blocos.push({ tipo: "espaco", altura: 20 });
    blocos.push({ tipo: "divisor" });
    blocos.push({ tipo: "secao", texto: "⚠️ Tratativas realizadas" });
    blocos.push({ tipo: "linha", texto: tratativas.trim(), cor: CINZA_TEXTO });
  }

  return blocos;
}

/**
 * Gera o PNG do relatório e devolve como `Blob`. Duas passagens sobre o
 * mesmo canvas: a 1ª só mede a altura total (texto quebrado incluso) para
 * dimensionar o canvas certo; a 2ª desenha de verdade. Fundo branco,
 * cabeçalho azul (identidade Ragga), formato vertical.
 */
export async function gerarImagemRelatorio(report: WhatsappReportData, tratativas: string): Promise<Blob> {
  const blocos = montarBlocos(report, tratativas);

  // Canvas temporário só para medir (mesmas fontes usadas no desenho real).
  const medidor = document.createElement("canvas");
  const ctxMedidorNulavel = medidor.getContext("2d");
  if (!ctxMedidorNulavel) throw new Error("Não foi possível obter o contexto 2D do canvas.");
  const ctxMedidor: CanvasRenderingContext2D = ctxMedidorNulavel;

  const ALTURA_CABECALHO = 150;
  let alturaConteudo = 32; // respiro inicial após o cabeçalho

  function medirBloco(bloco: Bloco): number {
    if (bloco.tipo === "espaco") return bloco.altura;
    if (bloco.tipo === "divisor") return 25;
    if (bloco.tipo === "secao") return 34;
    if (bloco.tipo === "item") {
      ctxMedidor.font = "20px Arial, sans-serif";
      return quebrarTexto(ctxMedidor, `• ${bloco.texto}`, LARGURA_CONTEUDO - 16).length * 26;
    }
    // "linha"
    ctxMedidor.font = `${bloco.negrito ? "bold " : ""}${bloco.tamanho ?? 20}px Arial, sans-serif`;
    return quebrarTexto(ctxMedidor, bloco.texto, LARGURA_CONTEUDO).length * ((bloco.tamanho ?? 20) + 10);
  }

  for (const bloco of blocos) alturaConteudo += medirBloco(bloco);
  const ALTURA_RODAPE = 60;
  const alturaTotal = ALTURA_CABECALHO + alturaConteudo + ALTURA_RODAPE;

  const canvas = document.createElement("canvas");
  canvas.width = LARGURA;
  canvas.height = alturaTotal;
  const ctxNulavel = canvas.getContext("2d");
  if (!ctxNulavel) throw new Error("Não foi possível obter o contexto 2D do canvas.");
  const ctx: CanvasRenderingContext2D = ctxNulavel;

  // Fundo branco.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LARGURA, alturaTotal);

  // Cabeçalho — identidade azul do painel.
  const gradiente = ctx.createLinearGradient(0, 0, LARGURA, ALTURA_CABECALHO);
  gradiente.addColorStop(0, RAGGA_BLUE);
  gradiente.addColorStop(1, RAGGA_BLUE_DARK);
  ctx.fillStyle = gradiente;
  ctx.fillRect(0, 0, LARGURA, ALTURA_CABECALHO);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Arial, sans-serif";
  ctx.textBaseline = "alphabetic";
  const tituloLinhas = quebrarTexto(ctx, "ADM/FINANCEIRO · CAIXAS (FECHAMENTO DIÁRIO) – GRUPO LONDRINO", LARGURA_CONTEUDO);
  let yCabecalho = 48;
  for (const linha of tituloLinhas) {
    ctx.fillText(linha, PADDING_X, yCabecalho);
    yCabecalho += 30;
  }
  ctx.font = "20px Arial, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(`📅 ${report.dateStr}`, PADDING_X, yCabecalho + 8);

  // Corpo.
  let y = ALTURA_CABECALHO + 40;

  function desenharBloco(bloco: Bloco) {
    if (bloco.tipo === "espaco") {
      y += bloco.altura;
      return;
    }
    if (bloco.tipo === "divisor") {
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PADDING_X, y);
      ctx.lineTo(LARGURA - PADDING_X, y);
      ctx.stroke();
      y += 25;
      return;
    }
    if (bloco.tipo === "secao") {
      ctx.font = "bold 21px Arial, sans-serif";
      ctx.fillStyle = RAGGA_BLUE_DARK;
      ctx.fillText(bloco.texto, PADDING_X, y);
      y += 34;
      return;
    }
    if (bloco.tipo === "item") {
      ctx.font = "20px Arial, sans-serif";
      ctx.fillStyle = CINZA_TEXTO;
      const linhas = quebrarTexto(ctx, `• ${bloco.texto}`, LARGURA_CONTEUDO - 16);
      for (const linha of linhas) {
        ctx.fillText(linha, PADDING_X + 16, y);
        y += 26;
      }
      return;
    }
    // "linha"
    const tamanho = bloco.tamanho ?? 20;
    ctx.font = `${bloco.negrito ? "bold " : ""}${tamanho}px Arial, sans-serif`;
    ctx.fillStyle = bloco.cor ?? CINZA_TEXTO;
    const linhas = quebrarTexto(ctx, bloco.texto, LARGURA_CONTEUDO);
    for (const linha of linhas) {
      ctx.fillText(linha, PADDING_X, y);
      y += tamanho + 10;
    }
  }

  for (const bloco of blocos) desenharBloco(bloco);

  // Rodapé.
  ctx.font = "italic 16px Arial, sans-serif";
  ctx.fillStyle = CINZA_CLARO;
  ctx.textAlign = "center";
  ctx.fillText("— Gestão Ragga · Financeiro", LARGURA / 2, alturaTotal - 24);
  ctx.textAlign = "left";

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Falha ao gerar a imagem (canvas.toBlob retornou vazio)."));
    }, "image/png");
  });
}

/** Dispara o download do blob gerado — nome de arquivo com a data do relatório. */
export function baixarImagem(blob: Blob, dateStr: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fechamento-${dateStr.replace(/\//g, "-")}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
