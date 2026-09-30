import { Card } from "@/components/ui/Card";
import type { BaseInfo } from "@/lib/services/atualizacaoBases";
import type { StatusBase } from "@/lib/services/statusBases.server";

// timeZone: "UTC" — datas desta camada são "puras" (meia-noite UTC), mesmo padrão já usado em outras telas.
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

/**
 * Card de base — reproduz `renderBaseUpdatePanel` (legado): nome/ícone,
 * "Alimenta:", botão "Atualizar base". Item 7 da etapa de revisão:
 * "Última atualização conhecida" e "Registros carregados" agora mostram
 * o período/quantidade REAIS já persistidos no Supabase (`status`), não
 * mais um texto fixo — nunca inventa dado: sem registro nenhum, mostra
 * "Sem dados" honestamente.
 */
export function BaseCard({
  base,
  status,
  onAtualizar,
}: {
  base: BaseInfo;
  status: StatusBase;
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
        <b>Período no banco:</b>{" "}
        {status.disponivel && status.periodoInicio && status.periodoFim
          ? `${formatadorData.format(status.periodoInicio)} a ${formatadorData.format(status.periodoFim)}`
          : "Sem dados"}
      </p>
      <p className="mt-1 text-xs text-foreground/60">
        <b>Registros no banco:</b> {status.disponivel ? status.totalRegistros : 0}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            status.disponivel ? "bg-semaforo-verde/10 text-semaforo-verde" : "bg-foreground/10 text-foreground/50"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${status.disponivel ? "bg-semaforo-verde" : "bg-foreground/40"}`} />
          {status.disponivel ? "Base carregada" : "Sem dados"}
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
