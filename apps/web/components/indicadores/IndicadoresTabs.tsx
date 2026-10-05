"use client";

import { useState } from "react";
import { BrindesPainel } from "./BrindesPainel";
import { CancelamentoPainel } from "./CancelamentoPainel";
import { FONTES_INDICADOR, type FonteIndicador } from "@/lib/services/indicadores";
import type { BrindesPainelData } from "@/lib/services/brindesPainel";
import type { CancelamentoPainelData } from "@/lib/services/cancelamentoPainel";

const FONTES_TELA_INDICADORES: FonteIndicador[] = ["brindes", "cancelamentoSalao", "cancelamentoDelivery"];

/**
 * Sub-abas de Indicadores: Brindes / Cancelamento Salão / Cancelamento Delivery. As três são painéis
 * analíticos (`BrindesPainel`/`CancelamentoPainel`) com filtros próprios (período atual, período comparado e
 * loja), a regra D-1 de cada aba e os thresholds já existentes (`semaforos.ts`).
 */
export function IndicadoresTabs({
  brindesPainel,
  cancelamentoSalaoPainel,
  cancelamentoDeliveryPainel,
  periodoPadrao,
  fonteInicial = "brindes",
  lojaInicial = "TODAS",
}: {
  brindesPainel: BrindesPainelData;
  cancelamentoSalaoPainel: CancelamentoPainelData;
  cancelamentoDeliveryPainel: CancelamentoPainelData;
  /** Período padrão (último mês fechado × mês anterior) dos painéis analíticos. */
  periodoPadrao: { inicio: string; fim: string; compInicio: string; compFim: string };
  /** Sub-aba aberta ao entrar (navegação por ?fonte=). */
  fonteInicial?: FonteIndicador;
  /** Loja pré-selecionada (navegação por ?loja=). */
  lojaInicial?: string;
}) {
  const [fonteAtiva, setFonteAtiva] = useState<FonteIndicador>(fonteInicial);
  const fontes = FONTES_INDICADOR.filter((f) => FONTES_TELA_INDICADORES.includes(f.fonte));

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-ragga-blue/10 px-6">
        {fontes.map((f) => (
          <button
            key={f.fonte}
            type="button"
            onClick={() => setFonteAtiva(f.fonte)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              fonteAtiva === f.fonte
                ? "border-ragga-blue text-ragga-blue"
                : "border-transparent text-foreground/60 hover:text-ragga-blue-dark"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-6 py-6">
        {fonteAtiva === "brindes" && <BrindesPainel dadosIniciais={brindesPainel} periodoInicial={periodoPadrao} lojaInicial={lojaInicial} />}
        {fonteAtiva === "cancelamentoSalao" && (
          <CancelamentoPainel
            fonte="cancelamentoSalao"
            rotulo="Cancelamento Salão"
            indicadorOrientacao="Cancelamento Salão"
            explicacao="Cancelamentos representam vendas lançadas no sistema que foram posteriormente canceladas. A análise por motivo ajuda a identificar as principais causas e oportunidades de redução."
            dadosIniciais={cancelamentoSalaoPainel}
            periodoInicial={periodoPadrao}
            lojaInicial={lojaInicial}
          />
        )}
        {fonteAtiva === "cancelamentoDelivery" && (
          <CancelamentoPainel
            fonte="cancelamentoDelivery"
            rotulo="Cancelamento Delivery"
            indicadorOrientacao="Cancelamento Delivery"
            explicacao="Cancelamentos Delivery representam pedidos lançados no sistema que foram posteriormente cancelados. A análise por motivo ajuda a identificar as principais causas e oportunidades de redução."
            dadosIniciais={cancelamentoDeliveryPainel}
            periodoInicial={periodoPadrao}
            lojaInicial={lojaInicial}
            tituloCard="Cancelamento Delivery"
            cardDetalhado
            textoSemDados="Sem dados no período selecionado."
          />
        )}
      </div>
    </div>
  );
}
