"use client";

import { UNIDADES, type CodigoUnidade } from "@painel/shared";

/**
 * Filtro padrão de "Loja + Período" (item 2 da etapa de revisão) —
 * visual único e compartilhado por Indicadores/Retiradas/Controles de
 * Caixa, no mesmo espírito de `FiltroDataReferencia.tsx`. O período
 * escolhido é só a REFERÊNCIA da tela: cada indicador continua aplicando
 * sua própria regra de deslocamento (D-1/D-2/semana/ciclo/data exata) em
 * cima dele — nenhuma regra de negócio é alterada aqui.
 */
export function FiltroLojaPeriodo({
  unidade,
  aoAlterarUnidade,
  dataInicio,
  dataFim,
  aoAlterarInicio,
  aoAlterarFim,
  carregando,
}: {
  unidade: string;
  aoAlterarUnidade: (unidade: string) => void;
  dataInicio: string;
  dataFim: string;
  aoAlterarInicio: (data: string) => void;
  aoAlterarFim: (data: string) => void;
  carregando?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm font-medium text-ragga-blue-dark">
        🏪 Loja
        <select
          value={unidade}
          onChange={(e) => aoAlterarUnidade(e.target.value)}
          className="rounded-md border border-ragga-blue/15 bg-ragga-surface px-3 py-2 text-sm"
        >
          <option value="TODAS">Todas as lojas</option>
          {UNIDADES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm font-medium text-ragga-blue-dark">
        📅 Período
        <input
          type="date"
          value={dataInicio}
          onChange={(e) => aoAlterarInicio(e.target.value)}
          className="rounded-md border border-ragga-blue/15 bg-ragga-surface px-3 py-2 text-sm"
        />
        <span className="text-foreground/50">até</span>
        <input
          type="date"
          value={dataFim}
          onChange={(e) => aoAlterarFim(e.target.value)}
          className="rounded-md border border-ragga-blue/15 bg-ragga-surface px-3 py-2 text-sm"
        />
      </label>

      {carregando && <span className="text-xs text-foreground/50">Carregando...</span>}
    </div>
  );
}

export type { CodigoUnidade };
