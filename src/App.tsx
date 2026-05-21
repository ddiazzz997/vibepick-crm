import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Dashboard from './components/Dashboard'
import Logo from './components/Logo'
import { supabase, supabaseMisconfigured } from './lib/supabase'

const ADMIN_EMAIL    = import.meta.env.VITE_ADMIN_EMAIL    as string
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD as string

type AuthStatus = 'loading' | 'login' | 'authorized'

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#050810' }}>
      <div className="flex flex-col items-center gap-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          style={{ width: 32, height: 32, border: '3px solid rgba(0,102,255,0.2)', borderTopColor: '#0066ff', borderRadius: '50%' }}
        />
        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem' }}>Verificando sesión…</p>
      </div>
    </div>
  )
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: '10px',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'white', fontSize: '0.88rem', outline: 'none', fontFamily: 'inherit',
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    await new Promise(r => setTimeout(r, 400))
    if (
      email.trim().toLowerCase() === (ADMIN_EMAIL ?? '').toLowerCase() &&
      password === ADMIN_PASSWORD
    ) {
      onSuccess()
    } else {
      setError('Acceso denegado. Credenciales incorrectas.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#050810' }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm mx-4 rounded-2xl p-8"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="mb-8 text-center">
          <Logo className="h-8 mx-auto mb-4" />
          <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Acceso CRM · Admin
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Correo admin" required style={inputStyle}
          />
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Contraseña" required style={inputStyle}
          />
          {error && (
            <p style={{ color: '#f87171', fontSize: '0.8rem', textAlign: 'center', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', padding: '8px' }}>
              {error}
            </p>
          )}
          <button
            type="submit" disabled={loading}
            style={{ padding: '13px', borderRadius: '12px', border: 'none', cursor: loading ? 'wait' : 'pointer', background: '#0066ff', color: 'white', fontWeight: 700, fontSize: '0.9rem', fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Verificando…' : 'Entrar al CRM'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}

function MisconfiguredScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#050810' }}>
      <div className="text-center max-w-sm mx-4 p-8 rounded-2xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
        <p style={{ color: '#f87171', fontWeight: 700, fontSize: '1rem', marginBottom: '8px' }}>Variables de entorno faltantes</p>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem', lineHeight: 1.6 }}>
          Configura <code style={{ color: '#fbbf24' }}>VITE_SUPABASE_URL</code> y{' '}
          <code style={{ color: '#fbbf24' }}>VITE_SUPABASE_ANON_KEY</code> en el panel de Vercel y redespliega.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const [status, setStatus] = useState<AuthStatus>('loading')

  useEffect(() => {
    const fallback = setTimeout(() => setStatus('login'), 2000)
    supabase.auth.getSession().then(({ data }) => {
      clearTimeout(fallback)
      const sessionEmail = data.session?.user?.email ?? ''
      if (sessionEmail.toLowerCase() === (ADMIN_EMAIL ?? '').toLowerCase()) {
        setStatus('authorized')
      } else {
        setStatus('login')
      }
    }).catch(() => {
      clearTimeout(fallback)
      setStatus('login')
    })
    return () => clearTimeout(fallback)
  }, [])

  if (supabaseMisconfigured) return <MisconfiguredScreen />
  if (status === 'loading') return <LoadingScreen />
  if (status === 'login')   return <AdminLogin onSuccess={() => setStatus('authorized')} />

  return (
    <AnimatePresence mode="wait">
      <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, height: '60px',
          background: 'rgba(5,8,16,0.95)', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', zIndex: 100, backdropFilter: 'blur(12px)',
        }}>
          <Logo className="h-8" />
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, color: '#0ea5e9',
              background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.2)',
              padding: '4px 10px', borderRadius: '20px', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              CRM · Admin
            </span>
            <button
              onClick={() => setStatus('login')}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
              style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                color: '#f87171', padding: '6px 14px', borderRadius: '8px',
                fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'inherit', transition: 'background 0.2s',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Cerrar sesión
            </button>
          </div>
        </div>
        <div style={{ paddingTop: '60px' }}>
          <Dashboard />
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
