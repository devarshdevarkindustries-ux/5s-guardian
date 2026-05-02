import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Never run auth logic for these paths
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  // PKCE / OAuth callbacks often land on `/` with `?code=...` — send users to onboarding
  // so the client can finish the exchange without role-based middleware blocking.
  if (pathname === '/' && request.nextUrl.searchParams.has('code')) {
    const url = request.nextUrl.clone()
    url.pathname = '/onboarding'
    return NextResponse.redirect(url)
  }

  let response = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const publicAuthPaths = pathname === '/login' || pathname === '/onboarding'

  if (!user) {
    if (publicAuthPaths) {
      return response
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Authenticated users can always complete onboarding (even before user_profiles exists)
  if (pathname === '/onboarding') {
    return response
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, force_password_change')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    return NextResponse.redirect(new URL('/onboarding', request.url))
  }

  if (pathname === '/change-password') {
    return response
  }

  if (profile.force_password_change) {
    return NextResponse.redirect(new URL('/change-password', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico|api).*)',
  ],
}

