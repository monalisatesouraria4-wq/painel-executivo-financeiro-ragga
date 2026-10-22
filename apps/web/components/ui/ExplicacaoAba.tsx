/**
 * Faixa curta que explica a aba aberta: a pergunta que ela responde e, em uma frase, como ler os números.
 * Só texto de apoio (nenhum cálculo); fica logo acima dos indicadores a que se refere.
 */
export function ExplicacaoAba({ pergunta, children }: { pergunta: string; children?: React.ReactNode }) {
  return (
    <div data-testid="explicacao-aba" className="mb-5 rounded-lg border border-ragga-blue/20 bg-ragga-blue/10 px-4 py-3">
      <p className="text-sm font-bold uppercase tracking-wide text-ragga-blue">{pergunta}</p>
      {children && <p className="mt-1 text-sm text-foreground/70">{children}</p>}
    </div>
  );
}
