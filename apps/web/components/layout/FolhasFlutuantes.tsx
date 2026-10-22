import type { CSSProperties } from "react";

/**
 * Folhas decorativas baseadas no ÍCONE OFICIAL da Ragga (`/brand/ragga-icone-folha.png`, azul), caindo e flutuando lentamente atrás
 * do conteúdo. Camada fixa, `aria-hidden` e sem eventos de ponteiro: não interfere na leitura nem nos cliques. A animação é só CSS
 * (ver `globals.css`): com "reduzir movimento" ligado no sistema, as folhas ficam paradas em posições fixas (versão estática).
 * Valores fixos (sem aleatoriedade em tempo de execução) para o servidor e o navegador renderizarem exatamente o mesmo HTML.
 */
interface Folha {
  /** posição horizontal (% da largura) */
  x: number;
  /** largura em px */
  tam: number;
  /** duração da queda (s) */
  dur: number;
  /** atraso NEGATIVO (s): a folha já começa em algum ponto da queda */
  atraso: number;
  /** duração do balanço lateral (s) */
  balanco: number;
  /** opacidade máxima (discreta) */
  op: number;
  rot0: number;
  rot1: number;
  /** deriva horizontal total (px) */
  deriva: number;
  /** posição vertical na versão estática (% da altura) */
  yFixo: number;
}

const FOLHAS: Folha[] = [
  { x: 4, tam: 46, dur: 58, atraso: -12, balanco: 7, op: 0.16, rot0: -20, rot1: 160, deriva: 60, yFixo: 12 },
  { x: 11, tam: 28, dur: 44, atraso: -30, balanco: 5.5, op: 0.11, rot0: 30, rot1: -150, deriva: -40, yFixo: 62 },
  { x: 19, tam: 62, dur: 70, atraso: -48, balanco: 9, op: 0.13, rot0: 10, rot1: 200, deriva: 80, yFixo: 34 },
  { x: 27, tam: 34, dur: 52, atraso: -8, balanco: 6, op: 0.12, rot0: -40, rot1: 120, deriva: -60, yFixo: 80 },
  { x: 35, tam: 52, dur: 64, atraso: -22, balanco: 8, op: 0.15, rot0: 20, rot1: -180, deriva: 50, yFixo: 8 },
  { x: 43, tam: 24, dur: 40, atraso: -35, balanco: 5, op: 0.1, rot0: -10, rot1: 140, deriva: -30, yFixo: 52 },
  { x: 51, tam: 58, dur: 76, atraso: -60, balanco: 10, op: 0.12, rot0: 40, rot1: -210, deriva: 90, yFixo: 22 },
  { x: 59, tam: 30, dur: 48, atraso: -16, balanco: 6.5, op: 0.13, rot0: -30, rot1: 170, deriva: -70, yFixo: 72 },
  { x: 67, tam: 48, dur: 60, atraso: -40, balanco: 7.5, op: 0.15, rot0: 15, rot1: -140, deriva: 40, yFixo: 42 },
  { x: 74, tam: 26, dur: 42, atraso: -5, balanco: 5, op: 0.1, rot0: -25, rot1: 130, deriva: -50, yFixo: 90 },
  { x: 81, tam: 66, dur: 80, atraso: -55, balanco: 11, op: 0.12, rot0: 25, rot1: -190, deriva: 70, yFixo: 16 },
  { x: 88, tam: 36, dur: 54, atraso: -28, balanco: 6, op: 0.14, rot0: -15, rot1: 150, deriva: -45, yFixo: 58 },
  { x: 94, tam: 50, dur: 66, atraso: -44, balanco: 8.5, op: 0.14, rot0: 35, rot1: -170, deriva: 55, yFixo: 30 },
  { x: 97, tam: 22, dur: 38, atraso: -20, balanco: 4.5, op: 0.1, rot0: -35, rot1: 110, deriva: -35, yFixo: 76 },
];

export function FolhasFlutuantes() {
  return (
    <div className="folhas-fundo" aria-hidden="true" data-testid="folhas-flutuantes">
      {FOLHAS.map((f, i) => (
        <div
          key={i}
          className="folha"
          style={
            {
              "--x": `${f.x}%`,
              "--tam": `${f.tam}px`,
              "--dur": `${f.dur}s`,
              "--atraso": `${f.atraso}s`,
              "--balanco": `${f.balanco}s`,
              "--op": f.op,
              "--rot0": `${f.rot0}deg`,
              "--rot1": `${f.rot1}deg`,
              "--deriva": `${f.deriva}px`,
              "--y-fixo": `${f.yFixo}%`,
            } as CSSProperties
          }
        >
          <span />
        </div>
      ))}
    </div>
  );
}

export const TOTAL_FOLHAS = FOLHAS.length;
