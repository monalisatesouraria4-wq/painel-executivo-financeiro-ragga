"use client";

import { useState } from "react";
import { BASE_REGISTRY, buscarBaseInfo, type BaseId } from "@/lib/services/atualizacaoBases";
import type { StatusBase } from "@/lib/services/statusBases.server";
import type { RegistroBase } from "@/lib/import/tipos";
import { buscarStatusBasePorId } from "@/lib/actions/buscarStatusBases";
import { BaseCard } from "./BaseCard";
import { BaseUpdateModal } from "./BaseUpdateModal";

type EstadoPorBase = Record<BaseId, RegistroBase[]>;

function estadoInicial(): EstadoPorBase {
  const estado = {} as EstadoPorBase;
  for (const base of BASE_REGISTRY) estado[base.id] = [];
  return estado;
}

/**
 * Reproduz `renderBaseUpdatePanel` (legado): grid de cards, um por base,
 * cada um abrindo o modal de upload correspondente. Item 7 da etapa de
 * revisão: cada card agora mostra o período/quantidade REAIS já
 * persistidos no Supabase (`statusInicial`, buscado no servidor), não
 * mais um texto fixo "nesta sessão" — e é atualizado automaticamente
 * após cada upload bem-sucedido.
 */
export function AtualizacaoBasesView({ statusInicial }: { statusInicial: Record<BaseId, StatusBase> }) {
  const [estadoPorBase, setEstadoPorBase] = useState<EstadoPorBase>(estadoInicial);
  const [statusPorBase, setStatusPorBase] = useState<Record<BaseId, StatusBase>>(statusInicial);
  const [baseAberta, setBaseAberta] = useState<BaseId | null>(null);

  async function atualizarStatus(id: BaseId) {
    const status = await buscarStatusBasePorId(id);
    setStatusPorBase((atual) => ({ ...atual, [id]: status }));
  }

  return (
    <main className="flex-1 px-6 py-6">
      <p className="mb-4 text-sm text-foreground/60">
        Atualize as fontes de dados utilizadas pelo Painel Executivo Financeiro.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BASE_REGISTRY.map((base) => (
          <BaseCard key={base.id} base={base} status={statusPorBase[base.id]} onAtualizar={() => setBaseAberta(base.id)} />
        ))}
      </div>

      {baseAberta && (
        <BaseUpdateModal
          base={buscarBaseInfo(baseAberta)}
          estadoAtual={estadoPorBase[baseAberta]}
          onFechar={() => setBaseAberta(null)}
          onSucesso={(novoEstado) => {
            setEstadoPorBase((atual) => ({ ...atual, [baseAberta]: novoEstado }));
            void atualizarStatus(baseAberta);
          }}
        />
      )}
    </main>
  );
}
