"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAVEGACAO_ADMIN, NAVEGACAO_PRINCIPAL } from "@/lib/navegacao";

interface SidebarProps {
  mobileAberta: boolean;
  onFechar: () => void;
}

/**
 * Sidebar persistente. Desktop/tablet (md+): coluna fixa no fluxo,
 * recolhível via botão «/». Mobile (<md): vira drawer sobreposto
 * (translate-x + backdrop), fechado por padrão, aberto pelo botão ☰ do
 * MobileTopBar; fecha ao navegar ou ao clicar no backdrop.
 */
export function Sidebar({ mobileAberta, onFechar }: SidebarProps) {
  const pathname = usePathname();
  const [recolhida, setRecolhida] = useState(false);

  const itemClasse = (ativo: boolean) =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      ativo
        ? "bg-ragga-blue/10 text-ragga-blue border-l-2 border-ragga-blue"
        : "text-foreground/70 hover:bg-ragga-bg hover:text-ragga-blue-dark border-l-2 border-transparent"
    }`;

  return (
    <>
      {mobileAberta && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={onFechar}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-ragga-blue/10 bg-ragga-surface transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-[width] ${
          mobileAberta ? "translate-x-0" : "-translate-x-full"
        } ${recolhida ? "md:w-16" : "md:w-64"}`}
      >
        <div className="flex items-center justify-between border-b border-ragga-blue/10 px-4 py-4">
          {!recolhida && (
            <div>
              <p className="text-xs font-medium text-ragga-blue">Grupo Londrino / Ragga</p>
              <p className="text-sm font-semibold text-ragga-blue-dark">Painel Executivo</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setRecolhida((v) => !v)}
            aria-label={recolhida ? "Expandir menu" : "Recolher menu"}
            className="hidden rounded-md p-1.5 text-ragga-blue-dark hover:bg-ragga-bg md:block"
          >
            {recolhida ? "»" : "«"}
          </button>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar menu"
            className="rounded-md p-1.5 text-ragga-blue-dark hover:bg-ragga-bg md:hidden"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-4">
          {NAVEGACAO_PRINCIPAL.map((item) => {
            const ativo = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onFechar}
                className={itemClasse(ativo)}
                title={recolhida ? item.nome : undefined}
              >
                <span className="text-base leading-none">{item.icone}</span>
                {!recolhida && <span className="md:inline">{item.nome}</span>}
              </Link>
            );
          })}

          <div className="mt-4 border-t border-ragga-blue/10 pt-4">
            {!recolhida && (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-foreground/40">
                Administração
              </p>
            )}
            {NAVEGACAO_ADMIN.map((item) => {
              const ativo = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onFechar}
                  className={itemClasse(ativo)}
                  title={recolhida ? item.nome : undefined}
                >
                  <span className="text-base leading-none">{item.icone}</span>
                  {!recolhida && <span>{item.nome}</span>}
                </Link>
              );
            })}
          </div>
        </nav>
      </aside>
    </>
  );
}
