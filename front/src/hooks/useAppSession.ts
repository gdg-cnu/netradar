import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isDemoMode } from '../services/api'
import { supabase } from '../services/auth'
import { setStorageScope } from '../utils/storage'

interface AppUser {
  id: string
  name: string
  demo: boolean
}
const demoUser: AppUser = { id: 'demo', name: '데모 기사', demo: true }
function demoSessionExists() {
  try {
    return isDemoMode() && localStorage.getItem('netradar:demo-session') === 'active'
  } catch {
    return false
  }
}
function toUser(session: Session): AppUser {
  return {
    id: session.user.id,
    name:
      session.user.user_metadata.full_name || session.user.user_metadata.name || '기사님',
    demo: false,
  }
}

export function useAppSession() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let mounted = true
    function applySession(session: Session | null) {
      if (!mounted) return
      if (expiredSession && session) return
      const next = session ? toUser(session) : demoSessionExists() ? demoUser : null
      setStorageScope(next?.id || 'demo')
      setUser(next)
      setReady(true)
    }
    let expiredSession = false
    const expired = () => {
      expiredSession = true
      try {
        localStorage.removeItem('netradar:demo-session')
      } catch {
        /* No stored session. */
      }
      setStorageScope('demo')
      setUser(null)
      setError('로그인이 만료되었습니다. 다시 로그인해 주세요.')
      void supabase?.auth.signOut({ scope: 'local' })
    }
    window.addEventListener('netradar:unauthorized', expired)
    if (!supabase) applySession(null)
    else {
      supabase.auth
        .getSession()
        .then(({ data, error: sessionError }) => {
          if (!mounted) return
          if (sessionError)
            setError('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.')
          applySession(data.session)
        })
        .catch(() => {
          if (mounted) {
            setError('로그인 상태를 확인하지 못했습니다.')
            applySession(null)
          }
        })
    }
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') expiredSession = false
      if (!expiredSession || !session) applySession(session)
    }).data.subscription
    return () => {
      mounted = false
      subscription?.unsubscribe()
      window.removeEventListener('netradar:unauthorized', expired)
    }
  }, [])
  function loginDemo() {
    if (!isDemoMode()) return
    setStorageScope('demo')
    try {
      localStorage.setItem('netradar:demo-session', 'active')
    } catch {
      /* Memory session remains usable. */
    }
    setUser(demoUser)
    setError('')
  }
  async function logout() {
    if (user && !user.demo && supabase) {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) {
        setError('로그아웃하지 못했습니다. 다시 시도해 주세요.')
        return
      }
    }
    try {
      localStorage.removeItem('netradar:demo-session')
    } catch {
      /* No stored session to remove. */
    }
    setStorageScope('demo')
    setUser(null)
    setError('')
  }
  return { user, ready, error, loginDemo, logout }
}
