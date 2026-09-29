"use client";

import { useState, useTransition } from "react";
import { RetiradaDepositoTab } from "./RetiradaDepositoTab";
import { IndicadorPainel } from "@/components/indicadores/IndicadorPainel";
import { FiltroDataReferencia, paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import type { RetiradaDepositoDiaData } from "@/lib/services/retiradaDeposito";
import type { IndicadorData } from "@/lib/services/indicadores";
import { buscarRetiradaDepositoDiaPorData } from "@/lib/actions/buscarRetiradaDepositoDiaPorData";
import { buscarIndicadorPorData } from "@/lib/actions/buscarIndicadorPorData";

/**
 * Sub-abas de Retiradas — mesmos rótulos exatos do sidebar do legado
 * (linhas 631-632): "Retirada para Depósito" e "Retirada Compra Direta".
 * Filtro de Data de Referência compartilhado entre as duas sub-abas —
 * cada uma continua aplicando sua própria regra (D-1) sobre a mesma data.
 */
const SUBABAS = [
  { id: "deposito", nome: "Retirada para Depósito" },
  { id: "compradireta", nome: "Retirada Compra Direta" },
] as const;

type SubAba = (typeof SUBABAS)[number]["id"];

export function RetiradasTabs({
  depositoDia,
  compraDireta,
  dataInicial,
}: {
  depositoDia: RetiradaDepositoDiaData;
  compraDireta: IndicadorData;
  dataInicial: Date;
}) {
  const [subAtiva, setSubAtiva] = useState<SubAba>("deposito");
  const [dataSelecionada, setDataSelecionada] = useState(() => paraInputDate(dataInicial));
  const [dadosDeposito, setDadosDeposito] = useState(depositoDia);
  const [dadosCompraDireta, setDadosCompraDireta] = useState(compraDireta);
  const [pendente, iniciarTransicao] = useTransition();

  function alterarData(novaData: string) {
    setDataSelecionada(novaData);
    iniciarTransicao(async () => {
      const data = dataDoInput(novaData);
      const [deposito, compra] = await Promise.all([
        buscarRetiradaDepositoDiaPorData(data),
        buscarIndicadorPorData("compraDireta", data),
      ]);
      setDadosDeposito(deposito);
      setDadosCompraDireta(compra);
    });
  }

  return (
    <div>
      <div className="border-b border-ragga-blue/10 px-6 py-3">
        <FiltroDataReferencia valor={dataSelecionada} aoAlterar={alterarData} carregando={pendente} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-ragga-blue/10 px-6">
        {SUBABAS.map((sub) => (
          <button
            key={sub.id}
            type="button"
            onClick={() => setSubAtiva(sub.id)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              subAtiva === sub.id
                ? "border-ragga-blue text-ragga-blue"
                : "border-transparent text-foreground/60 hover:text-ragga-blue-dark"
            }`}
          >
            {sub.nome}
          </button>
        ))}
      </div>

      <div className="px-6 py-6">
        {subAtiva === "deposito" && <RetiradaDepositoTab dadosDia={dadosDeposito} />}
        {subAtiva === "compradireta" && <IndicadorPainel dados={dadosCompraDireta} />}
      </div>
    </div>
  );
}
