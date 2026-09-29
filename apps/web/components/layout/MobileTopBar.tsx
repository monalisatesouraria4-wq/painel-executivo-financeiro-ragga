export function MobileTopBar({ onAbrirMenu }: { onAbrirMenu: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-ragga-blue/10 bg-ragga-surface px-4 py-3 md:hidden">
      <button
        type="button"
        onClick={onAbrirMenu}
        aria-label="Abrir menu"
        className="rounded-md p-1.5 text-ragga-blue-dark hover:bg-ragga-bg"
      >
        ☰
      </button>
      <div>
        <p className="text-[11px] font-medium leading-none text-ragga-blue">Grupo Londrino / Ragga</p>
        <p className="text-sm font-semibold leading-tight text-ragga-blue-dark">Painel Executivo</p>
      </div>
    </div>
  );
}
