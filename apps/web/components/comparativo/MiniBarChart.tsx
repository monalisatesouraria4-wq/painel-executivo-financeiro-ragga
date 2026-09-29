"use client";

interface Ponto {
  mes: string;
  rotulo: string;
  disponivel: boolean;
  valor?: number;
}

/**
 * Gráfico de barras simples em SVG puro — sem biblioteca de gráficos
 * (projeto não tinha nenhuma instalada; evita adicionar uma nova
 * dependência só para o Comparativo). Barras "Sem dados" aparecem
 * tracejadas/vazias, nunca como zero. Uma única cor para todas as barras
 * (o mês mais recente só fica com opacidade maior, para orientar o olho
 * sem "julgar" o valor) — não há classificação de aumento/redução como
 * bom ou ruim, conforme pedido explicitamente nesta etapa.
 */
export function MiniBarChart({
  pontos,
  formatador,
  corBarra = "var(--ragga-blue)",
}: {
  pontos: Ponto[];
  formatador: (v: number) => string;
  corBarra?: string;
}) {
  const largura = 760;
  const altura = 260;
  const margemInferior = 34;
  const margemSuperior = 30;
  const alturaUtil = altura - margemInferior - margemSuperior;
  const larguraBarra = largura / pontos.length;

  const valoresDisponiveis = pontos.filter((p) => p.disponivel && p.valor !== undefined).map((p) => p.valor!);
  const maxAbs = Math.max(1, ...valoresDisponiveis.map((v) => Math.abs(v)));
  const ultimoIndiceDisponivel = pontos.map((p) => p.disponivel).lastIndexOf(true);

  // Linhas de grade horizontais (25/50/75/100%) — só orientação visual, sem valores inventados.
  const gradesHorizontais = [0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${largura} ${altura}`} className="w-full" role="img">
      {gradesHorizontais.map((f) => (
        <line
          key={f}
          x1={0}
          y1={altura - margemInferior - f * alturaUtil}
          x2={largura}
          y2={altura - margemInferior - f * alturaUtil}
          stroke="var(--ragga-blue)"
          strokeOpacity={0.08}
        />
      ))}
      <line
        x1={0}
        y1={altura - margemInferior}
        x2={largura}
        y2={altura - margemInferior}
        stroke="var(--ragga-blue)"
        strokeOpacity={0.25}
      />
      {pontos.map((p, i) => {
        const x = i * larguraBarra + larguraBarra * 0.22;
        const w = larguraBarra * 0.56;
        if (!p.disponivel || p.valor === undefined) {
          return (
            <g key={p.mes}>
              <rect x={x} y={altura - margemInferior - 4} width={w} height={4} fill="var(--ragga-blue)" fillOpacity={0.15} />
              <text x={x + w / 2} y={altura - 12} fontSize={12} textAnchor="middle" fill="currentColor" opacity={0.5}>
                {p.rotulo}
              </text>
              <text x={x + w / 2} y={altura - margemInferior - 10} fontSize={10} textAnchor="middle" fill="currentColor" opacity={0.4}>
                s/ dado
              </text>
            </g>
          );
        }
        const h = Math.max(2, (Math.abs(p.valor) / maxAbs) * alturaUtil);
        const y = altura - margemInferior - h;
        const ehUltimo = i === ultimoIndiceDisponivel;
        return (
          <g key={p.mes}>
            <rect x={x} y={y} width={w} height={h} fill={corBarra} fillOpacity={ehUltimo ? 1 : 0.55} rx={3} />
            <text
              x={x + w / 2}
              y={y - 8}
              fontSize={ehUltimo ? 13 : 11}
              fontWeight={ehUltimo ? 600 : 400}
              textAnchor="middle"
              fill="currentColor"
            >
              {formatador(p.valor)}
            </text>
            <text
              x={x + w / 2}
              y={altura - 12}
              fontSize={12}
              fontWeight={ehUltimo ? 600 : 400}
              textAnchor="middle"
              fill="currentColor"
              opacity={ehUltimo ? 0.85 : 0.55}
            >
              {p.rotulo}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
