import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase para uso no browser (Auth, Storage).
 * Usa a anon key pública — nunca a service role key aqui.
 */
export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY não configuradas (ver .env.example)."
    );
  }

  return createClient(url, anonKey);
}
