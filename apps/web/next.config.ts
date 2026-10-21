import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /**
       * Limite do corpo das Server Actions (padrão do Next: 1 MB). A tela de importação envia o lote da planilha em formato COMPACTO
       * (`lib/import/loteCompacto.ts`): hoje o maior é Brindes, ~0,5 MB para 6.589 registros (~75 bytes/registro) — o formato anterior
       * já passava de 1 MB. 4 MB dá ~8x de folga (≈ 55 mil registros de Brindes) e fica abaixo do limite de payload de 4,5 MB das
       * Vercel Functions, que não pode ser ultrapassado por configuração. Não é "sem limite": as ações validam o lote (máx. 100 mil
       * registros) e a superfície continua pequena.
       */
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
