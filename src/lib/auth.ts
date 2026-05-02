import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  },
)

export type UserProfile = {
  id: string
  full_name: string | null
  role: 'super_admin' | 'admin' | 'auditor' | 'zone_leader' | 'supervisor'
  org_id: string | null
  plant_id: string | null
  org_name: string | null
  plant_name: string | null
  is_active: boolean
  force_password_change: boolean
}

export async function getCurrentUser(): Promise<UserProfile | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('user_profiles')
    .select(`
      id,
      full_name,
      role,
      org_id,
      plant_id,
      is_active,
      force_password_change,
      organisations(name),
      plants(name)
    `)
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return null

  return {
    id: profile.id,
    full_name: profile.full_name,
    role: profile.role,
    org_id: profile.org_id,
    plant_id: profile.plant_id,
    is_active: profile.is_active,
    force_password_change: Boolean(profile.force_password_change),
    org_name: (profile.organisations as any)?.name ?? null,
    plant_name: (profile.plants as any)?.name ?? null,
  }
}

export function getRoleHomeRoute(role: string | null | undefined): string {
  if (!role) return '/onboarding'
  switch (role) {
    case 'super_admin': return '/super-admin'
    case 'admin': return '/admin'
    case 'auditor': return '/auditor'
    case 'zone_leader': return '/dashboard'
    case 'supervisor': return '/dashboard'
    default: return '/onboarding'
  }
}

export function canAccess(userRole: string, allowedRoles: string[]): boolean {
  return allowedRoles.includes(userRole)
}

