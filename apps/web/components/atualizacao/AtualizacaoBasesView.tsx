"use client";

import { useState } from "react";
import { BASE_REGISTRY, buscarBaseInfo, type BaseId } from "@/lib/services/atualizacaoBases";
import type { RegistroBase } from "@/lib/import/tipos";
import { BaseCard } from "./BaseCard";
import { BaseUpdateModal } from "./BaseUpdateModal";

type EstadoPorBase = Record<BaseId, RegistroBase[]>;

function estadoInicial(): EstadoPorBase {
  const estado = {} as EstadoPorBase;
  for (const base of BASE_REGISTRY) estado[base.id] = [];
  return estado;
}

/**
 * Reproduz `renderBaseUpdatePanel` (legado): grid de 10 cards, um por
 * base, cada um abrindo o modal de upload correspondente. Estado
 * mantido só em memória do navegador (useState) — nunca persistido,
 * igual ao legado ("válido apenas para esta sessão do navegador").
 * Sem conexão de banco nesta etapa.
 */
export function AtualizacaoBasesView() {
  const [estadoPorBase, setEstadoPorBase] = useState<EstadoPorBase>(estadoInicial);
  const [baseAberta, setBaseAberta] = useState<BaseId | null>(null);

  return (
    <main className="flex-1 px-6 py-6">
      <p className="mb-4 text-sm text-foreground/60">
        Atualize as fontes de dados utilizadas pelo Painel Executivo Financeiro.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BASE_REGISTRY.map((base) => (
          <BaseCard
            key={base.id}
            base={base}
            registrosCarregados={estadoPorBase[base.id].length}
            onAtualizar={() => setBaseAberta(base.id)}
          />
        ))}
      </div>

      {baseAberta && (
        <BaseUpdateModal
          base={buscarBaseInfo(baseAberta)}
          estadoAtual={estadoPorBase[baseAberta]}
          onFechar={() => setBaseAberta(null)}
          onSucesso={(novoEstado) =>
            setEstadoPorBase((atual) => ({ ...atual, [baseAberta]: novoEstado }))
          }
        />
      )}
    </main>
  );
}
