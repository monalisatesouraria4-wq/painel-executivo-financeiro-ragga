export function EstadoVazio({ colSpan, texto }: { colSpan: number; texto?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-6 text-center text-sm text-foreground/50">
        {texto ?? "Sem dados disponíveis para este período."}
      </td>
    </tr>
  );
}
