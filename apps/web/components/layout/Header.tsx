interface HeaderProps {
  titulo: string;
  subtitulo?: string;
  /** Pergunta que a tela responde (aparece em destaque, em caixa alta, logo abaixo do título). */
  pergunta?: string;
}

export function Header({ titulo, subtitulo, pergunta }: HeaderProps) {
  return (
    <header className="border-b border-ragga-blue/10 bg-ragga-surface px-6 py-4">
      <h1 className="text-xl font-semibold text-ragga-blue-dark">{titulo}</h1>
      {pergunta && (
        <p data-testid="pergunta-da-tela" className="mt-1.5 text-sm font-bold uppercase tracking-wide text-ragga-blue">
          {pergunta}
        </p>
      )}
      {subtitulo && <p className="mt-1 text-sm text-foreground/60">{subtitulo}</p>}
    </header>
  );
}
