interface HeaderProps {
  titulo: string;
  subtitulo?: string;
}

export function Header({ titulo, subtitulo }: HeaderProps) {
  return (
    <header className="border-b border-ragga-blue/10 bg-ragga-surface px-6 py-4">
      <h1 className="text-xl font-semibold text-ragga-blue-dark">{titulo}</h1>
      {subtitulo && <p className="mt-1 text-sm text-foreground/60">{subtitulo}</p>}
    </header>
  );
}
