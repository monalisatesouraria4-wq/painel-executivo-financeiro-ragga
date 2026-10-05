"use client";

import { Card } from "@/components/ui/Card";
import { SemaforoBadge } from "@/components/ui/SemaforoBadge";
import type { CorSemaforo } from "@/lib/rules/semaforos";
import type { IndicadorData } from "@/lib/services/indicadores";

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TEXTO_SEMAFORO: Record<CorSemaforo, string> = {
  azul: "Excelente",
  verde: "Bom",
  amarelo: "Atenção",
  vermelho: "Crítico",
};

/** Cancelamento iFood — preenchido quando a base do iFood for importada. */
export interface CancelamentoIfood {
  valor: number;
  percentualFaturamento: number;
  semaforo: CorSemaforo;
}

/**
 * Cancelamento Delivery × Cancelamento iFood, em R$ reais. O lado Delivery
 * usa o total já calculado em `IndicadorData` (cancelamento_delivery,
 * sem alteração). O lado iFood só aparece quando houver base importada
 * (`ifood`) — enquanto isso mostra "aguardando base", sem inventar valor.
 */
export function DeliveryVsIfood({ delivery, ifood }: { delivery: IndicadorData; ifood?: CancelamentoIfood | null }) {
  const valorDelivery = delivery.disponivel ? (delivery.totalIndicador ?? 0) : null;
  const valorIfood = ifood ? ifood.valor : null;
  const totalComparado = (valorDelivery ?? 0) + (valorIfood ?? 0);
  const partDelivery = totalComparado > 0 && valorDelivery !== null ? (valorDelivery / totalComparado) * 100 : null;
  const partIfood = totalComparado > 0 && valorIfood !== null ? (valorIfood / totalComparado) * 100 : null;
  const diferenca = valorDelivery !== null && valorIfood !== null ? valorIfood - valorDelivery : null;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-ragga-blue-dark">Cancelamento Delivery × iFood</h3>
        {diferenca !== null && (
          <span className="text-xs text-foreground/60">
            Diferença: {formatadorMoeda.format(Math.abs(diferenca))} {diferenca > 0 ? "a mais no iFood" : "a mais no Delivery"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-ragga-blue/10 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">Delivery</p>
            {delivery.disponivel && delivery.semaforo && <SemaforoBadge cor={delivery.semaforo} texto={TEXTO_SEMAFORO[delivery.semaforo]} />}
          </div>
          <p className={`mt-2 text-[clamp(1.5rem,2.4vw,2.25rem)] font-extrabold leading-none ${valorDelivery !== null ? "text-ragga-blue-dark" : "text-foreground/20"}`}>
            {valorDelivery !== null ? formatadorMoeda.format(valorDelivery) : "—"}
          </p>
          <p className="mt-2 text-sm text-foreground/60">
            {valorDelivery !== null ? `${formatadorPercentual.format(delivery.percentualFaturamento ?? 0)}% do faturamento` : "Sem dados para esta referência"}
          </p>
        </div>

        <div className={`rounded-lg border p-4 ${ifood ? "border-ragga-blue/10" : "border-dashed border-ragga-blue/25 bg-ragga-bg/60"}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">iFood</p>
            {ifood && <SemaforoBadge cor={ifood.semaforo} texto={TEXTO_SEMAFORO[ifood.semaforo]} />}
          </div>
          <p className={`mt-2 text-[clamp(1.5rem,2.4vw,2.25rem)] font-extrabold leading-none ${ifood ? "text-ragga-blue-dark" : "text-foreground/20"}`}>
            {ifood ? formatadorMoeda.format(ifood.valor) : "—"}
          </p>
          <p className="mt-2 text-sm text-foreground/60">
            {ifood ? `${formatadorPercentual.format(ifood.percentualFaturamento)}% do faturamento` : "Aguardando a base de cancelamento iFood"}
          </p>
        </div>
      </div>

      {partDelivery !== null && partIfood !== null && (
        <div className="mt-4">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-ragga-bg">
            <div className="bg-ragga-blue-dark" style={{ width: `${partDelivery}%` }} />
            <div className="bg-semaforo-azul" style={{ width: `${partIfood}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-foreground/55">
            <span>Delivery {formatadorPercentual.format(partDelivery)}%</span>
            <span>iFood {formatadorPercentual.format(partIfood)}%</span>
          </div>
        </div>
      )}
    </Card>
  );
}
