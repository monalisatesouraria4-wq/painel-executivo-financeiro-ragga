import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { NAVEGACAO_PRINCIPAL } from "@/lib/navegacao";

export default function Home() {
  return (
    <>
      <Header titulo="Painel Executivo Financeiro" subtitulo="Grupo Londrino / Ragga" />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="w-full max-w-3xl">
          <p className="text-foreground/70">Selecione um módulo para começar.</p>

          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {NAVEGACAO_PRINCIPAL.map((modulo) => (
              <li key={modulo.href}>
                <Link
                  href={modulo.href}
                  className="flex items-center gap-3 rounded-lg border border-ragga-blue/15 bg-ragga-surface px-4 py-3 text-sm font-medium text-ragga-blue-dark shadow-sm transition-colors hover:bg-ragga-bg"
                >
                  <span className="text-base leading-none">{modulo.icone}</span>
                  {modulo.nome}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </>
  );
}
