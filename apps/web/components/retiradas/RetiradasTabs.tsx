"use client";

import { useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { RetiradaDepositoTab } from "./RetiradaDepositoTab";
import { CompraDiretaPainel } from "./CompraDiretaPainel";
import { FiltroLojaPeriodo } from "@/components/ui/FiltroLojaPeriodo";
import { paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import type { CompraDiretaPainelData } from "@/lib/services/compraDiretaPainel";

/**
 * Sub-abas de Retiradas — mesmos rótulos exatos do sidebar do legado
 * (linhas 631-632): "Retirada para Depósito" e "Retirada Compra Direta".
 * "Retirada para Depósito" mantém o filtro de Loja + Período (ciclo de depósito,
 * inalterado). "Retirada Compra Direta" é o painel de performance
 * (`CompraDiretaPainel`): filtros próprios (período atual + período de
 * comparação + loja), regra D-1 e thresholds já existentes.
 */
const SUBABAS = [
  { id: "deposito", nome: "Retirada para Depósito" },
  { id: "compradireta", nome: "Retirada Compra Direta" },
] as const;

type SubAba = (typeof SUBABAS)[number]["id"];

export function RetiradasTabs({
  compraDiretaPainel,
  periodoCompraDireta,
  dataInicial,
  subAbaInicial = "deposito",
  lojaInicial = "TODAS",
}: {
  compraDiretaPainel: CompraDiretaPainelData;
  periodoCompraDireta: { inicio: string; fim: string; compInicio: string; compFim: string };
  dataInicial: Date;
  /** Sub-aba aberta ao entrar (navegação por ?fonte=compraDireta). */
  subAbaInicial?: SubAba;
  /** Loja pré-selecionada no painel de Compra Direta (navegação por ?loja=). */
  lojaInicial?: string;
}) {
  const [subAtiva, setSubAtiva] = useState<SubAba>(subAbaInicial);
  const [unidade, setUnidade] = useState<string>("TODAS");
  const [dataInicio, setDataInicio] = useState(() => paraInputDate(dataInicial));
  const [dataFim, setDataFim] = useState(() => paraInputDate(dataInicial));

  const unidadeFiltro = unidade !== "TODAS" ? (unidade as CodigoUnidade) : undefined;

  return (
    <div>
      {subAtiva === "deposito" && (
        <div className="border-b border-ragga-blue/10 px-6 py-3">
          <FiltroLojaPeriodo
            unidade={unidade}
            aoAlterarUnidade={setUnidade}
            dataInicio={dataInicio}
            dataFim={dataFim}
            aoAlterarInicio={setDataInicio}
            aoAlterarFim={setDataFim}
          />
        </div>
      )}

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
        {subAtiva === "deposito" && (
          <RetiradaDepositoTab periodoInicio={dataDoInput(dataInicio)} periodoFim={dataDoInput(dataFim)} unidade={unidadeFiltro} />
        )}
        {subAtiva === "compradireta" && <CompraDiretaPainel dadosIniciais={compraDiretaPainel} periodoInicial={periodoCompraDireta} lojaInicial={lojaInicial} />}
      </div>
    </div>
  );
}
