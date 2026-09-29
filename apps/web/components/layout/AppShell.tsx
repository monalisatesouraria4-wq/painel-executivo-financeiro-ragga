"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MobileTopBar } from "./MobileTopBar";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileAberta, setMobileAberta] = useState(false);

  return (
    <div className="flex min-h-full flex-1">
      <Sidebar mobileAberta={mobileAberta} onFechar={() => setMobileAberta(false)} />
      <div className="flex min-h-full min-w-0 flex-1 flex-col">
        <MobileTopBar onAbrirMenu={() => setMobileAberta(true)} />
        {children}
      </div>
    </div>
  );
}
