"use client";

/**
 * Filtro de "Data de referência" — visual único e compartilhado por
 * todas as telas com dado sensível a data (Visão Geral, Indicadores,
 * Retiradas, Controles de Caixa, Fechamento Semanal, Fechamento
 * WhatsApp). Sempre visível (nunca atrás de menu/toggle). A data
 * escolhida é só a REFERÊNCIA — cada tela continua aplicando sua própria
 * regra de janela (D-1, D-2, semana real, ciclo 16→15, data exata) em
 * cima dela; nenhuma regra de negócio é alterada aqui.
 */
export function FiltroDataReferencia({
  valor,
  aoAlterar,
  carregando,
}: {
  valor: string;
  aoAlterar: (novaData: string) => void;
  carregando?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm font-medium text-ragga-blue-dark" htmlFor="filtro-data-referencia">
        📅 Data de referência
      </label>
      <input
        id="filtro-data-referencia"
        type="date"
        value={valor}
        onChange={(e) => aoAlterar(e.target.value)}
        className="rounded-md border border-ragga-blue/15 bg-ragga-surface px-3 py-2 text-sm"
      />
      {carregando && <span className="text-xs text-foreground/50">Carregando...</span>}
    </div>
  );
}

export function paraInputDate(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function dataDoInput(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}
