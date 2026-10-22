import type { CartaoImagem, ModeloImagem, SecaoImagem, TomVariacao } from "@/lib/services/resumoExecutivo";

/**
 * Imagem do Resumo Semanal Executivo (PNG para WhatsApp). Desenha em <canvas> nativo (mesma abordagem do Fechamento WhatsApp, sem
 * dependência nova) a partir de `ModeloImagem` — o MESMO modelo de dados que alimenta a tela e o texto. A logo oficial da Ragga
 * (arquivo oficial `/brand/ragga-logo-horizontal.png`, desenhada sobre plaqueta clara para manter o azul original legível) é desenhada DENTRO do arquivo gerado. Largura fixa de 1080 px × escala 2
 * (2160 px reais): boa resolução e proporção vertical; a altura cresce conforme o conteúdo e nada é cortado (textos longos quebram
 * linha; listas longas já chegam do modelo com "Demais n").
 */

const ESCALA = 2;
const LARGURA = 1080;
const MARGEM = 48;
const AZUL = "#4b73d6"; // azul de destaque (legível no escuro)
const AZUL_LOGO = "#2b4899"; // azul exato da logo oficial (faixa, folhas)
const AZUL_ESCURO = "#dbe6ff"; // texto forte (títulos)
const FUNDO = "#060d22"; // azul-marinho bem escuro
const CARTAO = "#0e1b3b"; // cartões: um pouco mais claros que o fundo
const CARTAO_INTERNO = "#0a1530";
const TEXTO = "#e6edfb";
const CINZA = "#8fa3cf";
const CINZA_CLARO = "#1f3262"; // bordas
const VERDE = "#3ccf86";
const VERMELHO = "#ff6b6b";
const AMBAR = "#e9b93c";
const FONTE = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

const COR_TOM: Record<TomVariacao, string> = { bom: VERDE, ruim: VERMELHO, neutro: CINZA };

export interface ImagemGerada {
  blob: Blob;
  /** Pré-visualização (data URL do mesmo PNG). */
  dataUrl: string;
  largura: number;
  altura: number;
  /** A logo oficial foi desenhada no arquivo (a geração falha se ela não carregar). */
  logoDesenhada: boolean;
}

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Não foi possível carregar a logo oficial (${src}).`));
    img.src = src;
  });
}

type Ctx = CanvasRenderingContext2D;

function quebrar(ctx: Ctx, texto: string, larguraMax: number): string[] {
  const palavras = texto.split(" ");
  const linhas: string[] = [];
  let atual = "";
  for (const p of palavras) {
    const teste = atual ? `${atual} ${p}` : p;
    if (ctx.measureText(teste).width > larguraMax && atual) {
      linhas.push(atual);
      atual = p;
    } else atual = teste;
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [""];
}

function retanguloArredondado(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fonte(ctx: Ctx, px: number, peso: "400" | "600" | "700" | "800" = "400", italico = false) {
  ctx.font = `${italico ? "italic " : ""}${peso} ${px}px ${FONTE}`;
}

// ───────────── medidas ─────────────

const COL_CARTOES = 3;
const GAP = 16;
const LARGURA_CONTEUDO = LARGURA - MARGEM * 2;
const LARG_CARTAO = (LARGURA_CONTEUDO - GAP * (COL_CARTOES - 1)) / COL_CARTOES;
const ALTURA_CARTAO = 132;
const LARG_SECAO = (LARGURA_CONTEUDO - GAP) / 2;

function alturaSecao(ctx: Ctx, s: SecaoImagem, largura: number): number {
  const larguraTexto = largura - 32 - 130; // espaço do valor à direita
  let h = 16 + 22 + 12; // padding topo + título + espaço
  fonte(ctx, 14);
  for (const l of s.linhas) h += quebrar(ctx, l.texto, l.valor ? larguraTexto : largura - 32).length * 20 + 4;
  if (s.nota) {
    fonte(ctx, 12, "400", true);
    h += quebrar(ctx, s.nota, largura - 32).length * 17 + 6;
  }
  return h + 14;
}

function desenharSecao(ctx: Ctx, s: SecaoImagem, x: number, y: number, largura: number, altura: number) {
  ctx.fillStyle = CARTAO;
  retanguloArredondado(ctx, x, y, largura, altura, 14);
  ctx.fill();
  ctx.strokeStyle = CINZA_CLARO;
  ctx.lineWidth = 1;
  ctx.stroke();
  // barra de título
  ctx.fillStyle = AZUL;
  retanguloArredondado(ctx, x + 16, y + 18, 4, 18, 2);
  ctx.fill();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = AZUL_ESCURO;
  fonte(ctx, 14, "800");
  ctx.fillText(s.titulo.toUpperCase(), x + 28, y + 33);
  if (s.total) {
    ctx.textAlign = "right";
    fonte(ctx, 16, "800");
    ctx.fillStyle = "#f2f6ff";
    ctx.fillText(s.total, x + largura - 16, y + 34);
  }
  let cy = y + 16 + 22 + 12 + 8;
  const larguraTexto = largura - 32 - 130;
  for (const l of s.linhas) {
    fonte(ctx, 14, l.destaque ? "700" : "400");
    ctx.fillStyle = l.destaque ? "#8fb0ff" : TEXTO;
    ctx.textAlign = "left";
    const partes = quebrar(ctx, l.texto, l.valor ? larguraTexto : largura - 32);
    partes.forEach((p, i) => ctx.fillText(p, x + 16, cy + i * 20));
    if (l.valor) {
      ctx.textAlign = "right";
      fonte(ctx, 14, "700");
      ctx.fillText(l.valor, x + largura - 16, cy);
    }
    cy += partes.length * 20 + 4;
  }
  if (s.nota) {
    fonte(ctx, 12, "400", true);
    ctx.fillStyle = CINZA;
    ctx.textAlign = "left";
    const partes = quebrar(ctx, s.nota, largura - 32);
    partes.forEach((p, i) => ctx.fillText(p, x + 16, cy + 6 + i * 17));
  }
}

function desenharCartao(ctx: Ctx, c: CartaoImagem, x: number, y: number) {
  ctx.fillStyle = CARTAO;
  retanguloArredondado(ctx, x, y, LARG_CARTAO, ALTURA_CARTAO, 16);
  ctx.fill();
  ctx.strokeStyle = CINZA_CLARO;
  ctx.lineWidth = 1;
  ctx.stroke();
  // faixa lateral
  ctx.fillStyle = c.semDados ? "#2a3c6e" : AZUL;
  retanguloArredondado(ctx, x, y + 14, 5, ALTURA_CARTAO - 28, 2.5);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  fonte(ctx, 12, "700");
  ctx.fillStyle = CINZA;
  const rotulo = quebrar(ctx, c.rotulo.toUpperCase(), LARG_CARTAO - 40);
  rotulo.forEach((l, i) => ctx.fillText(l, x + 22, y + 28 + i * 15));
  const yValor = y + 28 + (rotulo.length - 1) * 15 + 42;
  let tamanho = c.semDados ? 28 : 36;
  fonte(ctx, tamanho, "800");
  while (ctx.measureText(c.valor).width > LARG_CARTAO - 40 && tamanho > 18) {
    tamanho -= 2;
    fonte(ctx, tamanho, "800");
  }
  ctx.fillStyle = c.semDados ? "#5f719c" : "#f2f6ff";
  ctx.fillText(c.valor, x + 22, yValor);
  if (c.variacao) {
    fonte(ctx, 14, "700");
    ctx.fillStyle = COR_TOM[c.tom];
    ctx.fillText(c.variacao, x + 22, yValor + 24);
  }
  if (c.observacao) {
    fonte(ctx, 11, "400");
    ctx.fillStyle = CINZA;
    const partes = quebrar(ctx, c.observacao, LARG_CARTAO - 40);
    partes.slice(0, 2).forEach((p, i) => ctx.fillText(p, x + 22, y + ALTURA_CARTAO - 12 - (Math.min(partes.length, 2) - 1 - i) * 13));
  }
}

/** Gera o PNG. `geradoEm` (ISO) vai no rodapé. */
export async function gerarImagemResumoSemanal(modelo: ModeloImagem, geradoEm: string): Promise<ImagemGerada> {
  const [logo, folha] = await Promise.all([carregarImagem("/brand/ragga-logo-horizontal.png"), carregarImagem("/brand/ragga-icone-folha.png")]);

  // 1) medir (canvas auxiliar) para saber a altura total
  const medidor = document.createElement("canvas").getContext("2d");
  if (!medidor) throw new Error("Canvas indisponível neste navegador.");
  const linhasCartoes = Math.ceil(modelo.cartoes.length / COL_CARTOES);
  const alturaCartoes = linhasCartoes * ALTURA_CARTAO + (linhasCartoes - 1) * GAP;

  const itensForma = modelo.formas;
  const linhasForma = Math.ceil(itensForma.length / 3);
  fonte(medidor, 12, "400", true);
  const linhasNotaFormas = modelo.notaFormas ? quebrar(medidor, modelo.notaFormas, LARGURA_CONTEUDO - 32).length : 0;
  const alturaFormas = 16 + 22 + 14 + linhasForma * 56 + (linhasForma - 1) * 10 + (linhasNotaFormas ? linhasNotaFormas * 17 + 12 : 0) + 18;

  // seções em duas colunas (preenche sempre a coluna mais curta, preservando a ordem de leitura)
  const colunas: { y: number; itens: { s: SecaoImagem; y: number; h: number }[] }[] = [{ y: 0, itens: [] }, { y: 0, itens: [] }];
  for (const s of modelo.secoes) {
    const h = alturaSecao(medidor, s, LARG_SECAO);
    const alvo = colunas[0].y <= colunas[1].y ? colunas[0] : colunas[1];
    alvo.itens.push({ s, y: alvo.y, h });
    alvo.y += h + GAP;
  }
  const alturaSecoes = Math.max(colunas[0].y, colunas[1].y) - GAP;

  fonte(medidor, 12);
  const linhasAvisos = modelo.avisos.reduce((n, a) => n + quebrar(medidor, a, LARGURA_CONTEUDO - 32).length, 0);
  const alturaAvisos = modelo.avisos.length ? 16 + linhasAvisos * 17 + (modelo.avisos.length - 1) * 4 + 16 : 0;

  const ALTURA_CABECALHO = 98;
  const ALTURA_FAIXA = 128;
  const alturaTotal = Math.ceil(
    ALTURA_CABECALHO + ALTURA_FAIXA + 28 + alturaCartoes + 24 + alturaFormas + 24 + alturaSecoes + (alturaAvisos ? 24 + alturaAvisos : 0) + 28 + 56
  );

  // 2) desenhar
  const canvas = document.createElement("canvas");
  canvas.width = LARGURA * ESCALA;
  canvas.height = alturaTotal * ESCALA;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível neste navegador.");
  ctx.scale(ESCALA, ESCALA);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.fillStyle = FUNDO;
  ctx.fillRect(0, 0, LARGURA, alturaTotal);

  // folhas decorativas ESTÁTICAS (ícone oficial, em azul) atrás do conteúdo
  const folhasDecor: { x: number; y: number; w: number; rot: number; a: number }[] = [
    { x: 0.04, y: 0.1, w: 70, rot: -20, a: 0.2 }, { x: 0.9, y: 0.16, w: 56, rot: 25, a: 0.18 }, { x: 0.12, y: 0.34, w: 44, rot: 35, a: 0.14 },
    { x: 0.94, y: 0.38, w: 80, rot: -30, a: 0.16 }, { x: 0.03, y: 0.58, w: 90, rot: 15, a: 0.15 }, { x: 0.9, y: 0.62, w: 48, rot: 40, a: 0.14 },
    { x: 0.08, y: 0.8, w: 52, rot: -35, a: 0.16 }, { x: 0.93, y: 0.86, w: 84, rot: 20, a: 0.17 }, { x: 0.5, y: 0.97, w: 40, rot: -15, a: 0.14 },
  ];
  for (const f of folhasDecor) {
    const altura = (f.w * folha.naturalHeight) / folha.naturalWidth;
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, f.a * 2.1); // discretas, porém visíveis sobre o fundo escuro
    ctx.translate(f.x * LARGURA, f.y * alturaTotal);
    ctx.rotate((f.rot * Math.PI) / 180);
    ctx.drawImage(folha, -f.w / 2, -altura / 2, f.w, altura);
    ctx.restore();
  }

  // cabeçalho escuro com a logo oficial sobre plaqueta clara
  ctx.fillStyle = "#08122c";
  ctx.fillRect(0, 0, LARGURA, ALTURA_CABECALHO);
  const altLogo = 46;
  const largLogo = (logo.naturalWidth / logo.naturalHeight) * altLogo;
  const px = 14;
  const py = 9;
  ctx.fillStyle = "#f4f7ff";
  retanguloArredondado(ctx, MARGEM, (ALTURA_CABECALHO - altLogo) / 2 - py, largLogo + px * 2, altLogo + py * 2, 14);
  ctx.fill();
  ctx.drawImage(logo, MARGEM + px, (ALTURA_CABECALHO - altLogo) / 2, largLogo, altLogo);
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  fonte(ctx, 15, "700");
  ctx.fillStyle = "#f2f6ff";
  ctx.fillText(modelo.grupo.toUpperCase(), LARGURA - MARGEM, ALTURA_CABECALHO / 2 - 2);
  fonte(ctx, 12, "400");
  ctx.fillStyle = CINZA;
  ctx.fillText("Financeiro · Gestão", LARGURA - MARGEM, ALTURA_CABECALHO / 2 + 16);

  // faixa azul com título e período
  const grad = ctx.createLinearGradient(0, ALTURA_CABECALHO, LARGURA, ALTURA_CABECALHO + ALTURA_FAIXA);
  grad.addColorStop(0, AZUL_LOGO);
  grad.addColorStop(1, "#0f2257");
  ctx.fillStyle = grad;
  ctx.fillRect(0, ALTURA_CABECALHO, LARGURA, ALTURA_FAIXA);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  fonte(ctx, 38, "800");
  ctx.fillText(modelo.titulo, MARGEM, ALTURA_CABECALHO + 54);
  fonte(ctx, 20, "700");
  ctx.fillText(`📅 ${modelo.periodo} · ${modelo.grupo}`, MARGEM, ALTURA_CABECALHO + 88);
  fonte(ctx, 14, "400");
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.fillText(modelo.comparacao, MARGEM, ALTURA_CABECALHO + 112);

  // big numbers
  let y = ALTURA_CABECALHO + ALTURA_FAIXA + 28;
  modelo.cartoes.forEach((c, i) => {
    const col = i % COL_CARTOES;
    const lin = Math.floor(i / COL_CARTOES);
    desenharCartao(ctx, c, MARGEM + col * (LARG_CARTAO + GAP), y + lin * (ALTURA_CARTAO + GAP));
  });
  y += alturaCartoes + 24;

  // formas de pagamento
  ctx.fillStyle = CARTAO;
  retanguloArredondado(ctx, MARGEM, y, LARGURA_CONTEUDO, alturaFormas, 14);
  ctx.fill();
  ctx.strokeStyle = CINZA_CLARO;
  ctx.stroke();
  ctx.fillStyle = AZUL;
  retanguloArredondado(ctx, MARGEM + 16, y + 18, 4, 18, 2);
  ctx.fill();
  ctx.textAlign = "left";
  fonte(ctx, 14, "800");
  ctx.fillStyle = AZUL_ESCURO;
  ctx.fillText("FORMAS DE PAGAMENTO", MARGEM + 28, y + 33);
  const larguraChip = (LARGURA_CONTEUDO - 32 - 2 * 10) / 3;
  itensForma.forEach((f, i) => {
    const cx = MARGEM + 16 + (i % 3) * (larguraChip + 10);
    const cy = y + 16 + 22 + 14 + Math.floor(i / 3) * 66;
    ctx.fillStyle = CARTAO_INTERNO;
    retanguloArredondado(ctx, cx, cy, larguraChip, 56, 10);
    ctx.fill();
    ctx.textAlign = "left";
    fonte(ctx, 12, "700");
    ctx.fillStyle = CINZA;
    ctx.fillText(f.rotulo.toUpperCase(), cx + 14, cy + 22);
    fonte(ctx, 20, "800");
    ctx.fillStyle = f.semDados ? "#5f719c" : "#f2f6ff";
    ctx.fillText(f.valor, cx + 14, cy + 46);
  });
  if (modelo.notaFormas) {
    fonte(ctx, 12, "400", true);
    ctx.fillStyle = AMBAR;
    quebrar(ctx, modelo.notaFormas, LARGURA_CONTEUDO - 32).forEach((l, i) => ctx.fillText(l, MARGEM + 16, y + alturaFormas - 18 - (linhasNotaFormas - 1 - i) * 17));
  }
  y += alturaFormas + 24;

  // detalhamento
  colunas.forEach((col, ci) => {
    for (const it of col.itens) desenharSecao(ctx, it.s, MARGEM + ci * (LARG_SECAO + GAP), y + it.y, LARG_SECAO, it.h);
  });
  y += alturaSecoes;

  // avisos
  if (alturaAvisos) {
    y += 24;
    ctx.fillStyle = "#2a2410";
    retanguloArredondado(ctx, MARGEM, y, LARGURA_CONTEUDO, alturaAvisos, 12);
    ctx.fill();
    ctx.strokeStyle = "#5c4a14";
    ctx.stroke();
    fonte(ctx, 12);
    ctx.fillStyle = AMBAR;
    let ay = y + 16 + 12;
    for (const a of modelo.avisos) for (const l of quebrar(ctx, a, LARGURA_CONTEUDO - 32)) { ctx.fillText(l, MARGEM + 16, ay); ay += 17; }
    y += alturaAvisos;
  }

  // rodapé
  ctx.textAlign = "center";
  fonte(ctx, 13, "700");
  ctx.fillStyle = "#c9d8ff";
  ctx.fillText("— Gestão Ragga · Financeiro", LARGURA / 2, alturaTotal - 38);
  fonte(ctx, 11, "400");
  ctx.fillStyle = CINZA;
  const quando = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(geradoEm));
  ctx.fillText(`Gerado em ${quando}`, LARGURA / 2, alturaTotal - 20);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao gerar a imagem (canvas.toBlob retornou vazio)."))), "image/png"));
  return { blob, dataUrl: canvas.toDataURL("image/png"), largura: canvas.width, altura: canvas.height, logoDesenhada: true };
}

export function baixarImagemResumo(blob: Blob, inicio: string, fim: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `resumo-semanal-${inicio}_a_${fim}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
