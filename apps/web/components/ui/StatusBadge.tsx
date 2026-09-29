type Tom = "ok" | "warn" | "alert" | "neutro";

const CLASSES_POR_TOM: Record<Tom, string> = {
  ok: "bg-semaforo-verde/10 text-semaforo-verde",
  warn: "bg-semaforo-amarelo/10 text-semaforo-amarelo",
  alert: "bg-semaforo-vermelho/10 text-semaforo-vermelho",
  neutro: "bg-foreground/5 text-foreground/50",
};

export function StatusBadge({ tom, texto }: { tom: Tom; texto: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CLASSES_POR_TOM[tom]}`}>
      {texto}
    </span>
  );
}
