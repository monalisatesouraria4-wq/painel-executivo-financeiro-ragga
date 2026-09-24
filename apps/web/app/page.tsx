const MODULOS = [
  { nome: "Visão Geral", href: "/visao-geral" },
  { nome: "Comparativo", href: "/comparativo" },
  { nome: "Indicadores", href: "/indicadores" },
  { nome: "Controles de Caixa", href: "/controles-caixa" },
  { nome: "Análise Gerencial", href: "/analise-gerencial" },
  { nome: "Plano de Ação", href: "/plano-de-acao" },
  { nome: "Fechamento WhatsApp", href: "/fechamento-whatsapp" },
  { nome: "Fechamento Semanal", href: "/fechamento-semanal" },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-3xl">
        <p className="text-sm font-medium text-ragga-blue">Grupo Londrino / Ragga</p>
        <h1 className="mt-1 text-3xl font-semibold text-ragga-blue-dark">
          Painel Executivo Financeiro
        </h1>
        <p className="mt-3 text-foreground/70">
          Fundação do projeto (Etapa 1). Estrutura de módulos abaixo — telas completas
          e dados reais serão incorporados nas próximas etapas.
        </p>

        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MODULOS.map((modulo) => (
            <li
              key={modulo.href}
              className="rounded-lg border border-ragga-blue/15 bg-ragga-surface px-4 py-3 text-sm font-medium text-ragga-blue-dark shadow-sm"
            >
              {modulo.nome}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
