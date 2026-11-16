import { createClient } from '@supabase/supabase-js'

const url = import.meta.env?.VITE_SUPABASE_URL
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session?.access_token ?? null
}

export async function signInWithKakao() {
  if (!supabase)
    throw new Error(
      '카카오 로그인 연결이 준비되지 않았습니다. 데모로 화면을 확인할 수 있습니다.',
    )
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
  })
  if (error) throw error
}

export async function signInWithEmail(email: string, password: string) {
  if (!supabase) throw new Error('이메일 로그인 연결이 준비되지 않았습니다.')
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw error
  if (!data.session) throw new Error('로그인 세션을 확인하지 못했습니다.')
  return data.session
}

export async function signUpWithEmail(name: string, email: string, password: string) {
  if (!supabase) throw new Error('회원가입 연결이 준비되지 않았습니다.')
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { full_name: name.trim() },
      emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
    },
  })
  if (error) throw error
  if (!data.user) throw new Error('회원가입 응답을 확인하지 못했습니다.')
  return { requiresEmailConfirmation: !data.session }
}
