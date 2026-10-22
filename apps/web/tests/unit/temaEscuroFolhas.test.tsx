import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FolhasFlutuantes, TOTAL_FOLHAS } from "@/components/layout/FolhasFlutuantes";

/**
 * Identidade visual: tema azul-marinho escuro, recursos OFICIAIS da marca preservados, folhas animadas discretas (com alternativa estática
 * para "reduzir movimento") e imagem do Resumo Semanal com a logo oficial e folhas estáticas.
 */
const ler = (c: string) => readFileSync(c, "utf-8");
const css = ler("app/globals.css");
const dimensoesPng = (c: string) => {
  const b = readFileSync(c);
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
};
const sha = (c: string) => createHash("sha256").update(readFileSync(c)).digest("hex");
const luminancia = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const token = (nome: string) => css.match(new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`))![1];

describe("recursos oficiais da marca (preservados, com proporções originais)", () => {
  it("logo horizontal, ícone da folha e logo vertical estão em /public/brand com as dimensões dos arquivos enviados", () => {
    expect(dimensoesPng("public/brand/ragga-logo-horizontal.png")).toEqual({ largura: 1868, altura: 335 });
    expect(dimensoesPng("public/brand/ragga-icone-folha.png")).toEqual({ largura: 278, altura: 365 });
    expect(dimensoesPng("public/brand/ragga-logo-vertical.png")).toEqual({ largura: 904, altura: 924 });
  });
  it("os arquivos já existentes do projeto continuam intactos (ícone e logo vertical idênticos aos enviados)", () => {
    expect(sha("public/ragga-leaf.png")).toBe(sha("public/brand/ragga-icone-folha.png"));
    expect(sha("public/ragga-logo.png")).toBe(sha("public/brand/ragga-logo-vertical.png"));
    expect(existsSync("public/ragga-gestao-horizontal.svg")).toBe(true);
  });
});

describe("tema azul-marinho escuro", () => {
  it("fundo bem escuro; cartões um pouco mais claros que o fundo; texto claro", () => {
    expect(luminancia(token("background"))).toBeLessThan(0.02);
    expect(luminancia(token("surface"))).toBeGreaterThan(luminancia(token("background")));
    expect(luminancia(token("surface"))).toBeLessThan(0.05);
    expect(luminancia(token("foreground"))).toBeGreaterThan(0.7);
    expect(luminancia(token("texto-forte"))).toBeGreaterThan(0.7);
  });
  it("o azul da logo é o do arquivo oficial e a identidade é azul (sem verde/roxo de marca)", () => {
    expect(token("ragga-logo-blue").toLowerCase()).toBe("#2b4899");
    const b = parseInt(token("ragga-blue").slice(5, 7), 16);
    const r = parseInt(token("ragga-blue").slice(1, 3), 16);
    expect(b).toBeGreaterThan(r); // azul dominante
  });
});

describe("folhas flutuantes", () => {
  const html = renderToStaticMarkup(<FolhasFlutuantes />);
  it("camada decorativa: aria-hidden, sem interação, baseada no ícone oficial", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("folhas-fundo");
    expect((html.match(/class="folha"/g) ?? []).length).toBe(TOTAL_FOLHAS);
    expect(TOTAL_FOLHAS).toBeGreaterThanOrEqual(10);
    expect(css).toMatch(/\.folhas-fundo\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.folhas-fundo\s*\{[^}]*z-index:\s*0/);
    expect(css).toContain('url("/brand/ragga-icone-folha.png")');
  });
  it("animação só de transform/opacity (leve), lenta (≥ 38 s por queda) e discreta (opacidade ≤ 0,2)", () => {
    const duracoes = [...html.matchAll(/--dur:(\d+)s/g)].map((m) => Number(m[1]));
    expect(Math.min(...duracoes)).toBeGreaterThanOrEqual(38);
    const opacidades = [...html.matchAll(/--op:([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...opacidades)).toBeLessThanOrEqual(0.2);
    const keyframes = css.match(/@keyframes folha-cair\s*\{[\s\S]*?\n\}/)![0];
    expect(keyframes).not.toMatch(/\b(left|top|width|height|margin)\s*:/);
  });
  it("com 'reduzir movimento' ligado NÃO há animação: as folhas ficam estáticas", () => {
    const bloco = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}\n?$/m)![0];
    expect(bloco).toMatch(/animation:\s*none/);
    expect(bloco).toContain("var(--y-fixo)");
  });
  it("está montada atrás do conteúdo no layout raiz", () => {
    const layout = ler("app/layout.tsx");
    expect(layout.indexOf("<FolhasFlutuantes />")).toBeGreaterThan(-1);
    expect(layout.indexOf("<FolhasFlutuantes />")).toBeLessThan(layout.indexOf("<AppShell>"));
    expect(layout).toContain("relative z-10");
  });
});

describe("imagem PNG do Resumo Semanal", () => {
  const fonte = ler("components/resumoSemanal/gerarImagemResumoSemanal.ts");
  it("usa a logo oficial e o ícone oficial (arquivos de /brand), sobre o mesmo azul-marinho do painel", () => {
    expect(fonte).toContain("/brand/ragga-logo-horizontal.png");
    expect(fonte).toContain("/brand/ragga-icone-folha.png");
    expect(fonte).toContain('const FUNDO = "#060d22"');
    expect(fonte).toContain('const AZUL_LOGO = "#2b4899"');
  });
  it("a geração falha (não segue em silêncio) se a logo não carregar, e desenha folhas ESTÁTICAS decorativas", () => {
    expect(fonte).toContain("Não foi possível carregar a logo oficial");
    expect(fonte).toContain("folhasDecor");
    expect(fonte).not.toMatch(/requestAnimationFrame|setInterval/);
  });
});
