import { Card } from "@/components/ui/Card";
import type { BaseInfo } from "@/lib/services/atualizacaoBases";

/**
 * Card de base — reproduz `renderBaseUpdatePanel` (legado): nome/ícone,
 * "Alimenta:", "Última atualização conhecida:", "Registros carregados:",
 * selo "Base carregada" (verde, fixo — assim mesmo no legado, não
 * condicional a ter dado real) e botão "Atualizar base".
 */
export function BaseCard({
  base,
  registrosCarregados,
  onAtualizar,
}: {
  base: BaseInfo;
  registrosCarregados: number;
  onAtualizar: () => void;
}) {
  return (
    <Card>
      <p className="text-sm font-semibold text-ragga-blue-dark">
        {base.icone} {base.nome}
      </p>
      <p className="mt-2 text-xs text-foreground/60">
        <b>Alimenta:</b> {base.alimenta}
      </p>
      <p className="mt-1 text-xs text-foreground/60">
        <b>Última atualização conhecida:</b> {registrosCarregados > 0 ? "nesta sessão" : "—"}
      </p>
      <p className="mt-1 text-xs text-foreground/60">
        <b>Registros carregados:</b> {registrosCarregados}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-full bg-semaforo-verde/10 px-2 py-0.5 text-xs font-medium text-semaforo-verde">
          <span className="h-1.5 w-1.5 rounded-full bg-semaforo-verde" />
          Base carregada
        </span>
        <button
          type="button"
          onClick={onAtualizar}
          className="rounded-md bg-ragga-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-ragga-blue-dark"
        >
          Atualizar base
        </button>
      </div>
    </Card>
  );
}
