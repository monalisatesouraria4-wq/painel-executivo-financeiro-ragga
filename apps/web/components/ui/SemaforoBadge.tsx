import type { CorSemaforo } from "@/lib/rules/semaforos";

const CLASSES_POR_COR: Record<CorSemaforo, string> = {
  azul: "bg-semaforo-azul/10 text-semaforo-azul",
  verde: "bg-semaforo-verde/10 text-semaforo-verde",
  amarelo: "bg-semaforo-amarelo/10 text-semaforo-amarelo",
  vermelho: "bg-semaforo-vermelho/10 text-semaforo-vermelho",
};

export function SemaforoBadge({ cor, texto }: { cor: CorSemaforo; texto: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CLASSES_POR_COR[cor]}`}>
      {texto}
    </span>
  );
}
