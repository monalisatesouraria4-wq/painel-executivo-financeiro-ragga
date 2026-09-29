import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-ragga-blue/10 bg-ragga-surface p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
