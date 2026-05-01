import { createClient } from "@supabase/supabase-js";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log("URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);

const supabase = (() => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Proxy(
      {},
      {
        get() {
          throw new Error(
            "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (app root), then restart the dev server.",
          );
        },
      },
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey);
})();

export default supabase;

export function createServerClient(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  // Middleware needs a mutable response so Supabase can refresh cookies.
  const response = NextResponse.next({ request });

  const supabaseServer = createSupabaseServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  return { supabase: supabaseServer, response };
}

