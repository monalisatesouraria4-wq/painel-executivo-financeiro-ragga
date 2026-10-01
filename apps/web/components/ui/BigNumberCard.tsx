import Link from "next/link";
import type { ReactNode } from "react";
import { SemaforoBadge } from "./SemaforoBadge";
import type { CorSemaforo } from "@/lib/rules/semaforos";

const TEXTO_SEMAFORO: Record<CorSemaforo, string> = {
  azul: "Excelente",
  verde: "Bom",
  amarelo: "Atenção",
  vermelho: "Crítico",
};

const BARRA_POR_SEMAFORO: Record<CorSemaforo, string> = {
  azul: "bg-semaforo-azul",
  verde: "bg-semaforo-verde",
  amarelo: "bg-semaforo-amarelo",
  vermelho: "bg-semaforo-vermelho",
};

interface BigNumberCardProps {
  titulo: string;
  /** Valor já formatado (ex.: "R$ 1.234,56"). `undefined` = sem dado. */
  valor?: string;
  /** Linha logo abaixo do número (ex.: "0,42% do faturamento"). */
  detalhe?: string;
  semaforo?: CorSemaforo | null;
  /** Texto de apoio no rodapé (ex.: "3 lojas pedem ação"). */
  rodape?: ReactNode;
  /** Mensagem quando não há dado. */
  textoSemDado?: string;
  /** Navegação (link). Mutuamente exclusivo com `onClick`. */
  href?: string;
  onClick?: () => void;
  /** Card selecionado (destaque de borda) — usado quando o clique troca a visão na própria tela. */
  ativo?: boolean;
}

/**
 * Card "big number" clicável da central de caixa: número grande, semáforo
 * e barra de cor. Só apresentação — todo valor/semáforo chega pronto das
 * regras já existentes (nenhum cálculo novo aqui).
 */
export function BigNumberCard({ titulo, valor, detalhe, semaforo, rodape, textoSemDado, href, onClick, ativo }: BigNumberCardProps) {
  const disponivel = valor !== undefined;
  const classes = `group relative block w-full overflow-hidden rounded-xl border bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ragga-blue ${
    ativo ? "border-ragga-blue ring-1 ring-ragga-blue/40" : "border-ragga-blue/10"
  }`;

  const conteudo = (
    <>
      <span
        className={`absolute inset-y-0 left-0 w-1.5 ${disponivel && semaforo ? BARRA_POR_SEMAFORO[semaforo] : "bg-ragga-blue/20"}`}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-2 pl-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">{titulo}</p>
        {disponivel && semaforo && <SemaforoBadge cor={semaforo} texto={TEXTO_SEMAFORO[semaforo]} />}
      </div>
      {disponivel ? (
        <p className="mt-2 pl-1 text-[2.25rem] font-extrabold leading-none tracking-tight text-ragga-blue-dark">{valor}</p>
      ) : (
        <p className="mt-2 pl-1 text-[2.25rem] font-extrabold leading-none text-foreground/20">—</p>
      )}
      <p className="mt-2 pl-1 text-sm text-foreground/60">{disponivel ? detalhe : (textoSemDado ?? "Sem dados para esta referência")}</p>
      <div className="mt-3 flex items-center justify-between pl-1 text-xs">
        <span className="text-foreground/50">{rodape}</span>
        <span className="font-medium text-ragga-blue opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Abrir →</span>
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {conteudo}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} className={classes}>
      {conteudo}
    </button>
  );
}
