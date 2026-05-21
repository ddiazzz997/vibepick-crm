import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { GoogleGenerativeAI } from '@google/generative-ai'
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer,
} from 'recharts'

// ── Gemini setup ─────────────────────────────────────────
const _apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
let _genAI: GoogleGenerativeAI | null = null
if (_apiKey) _genAI = new GoogleGenerativeAI(_apiKey)

// ── Interfaces ────────────────────────────────────────────
interface DashUser {
    id: string; name: string; email: string; phone: string
    registeredAt: string; isPro: boolean; sessionCount: number
    totalMinutes: number
}
interface DashScore  { email: string; score: number; nivel: string }
interface DashPipeline { email: string; name: string; stage: string; updatedAt: string; notes?: string }
interface DashSession  { email: string; duration: number; prompts: number; date: string }
interface ChurnMonthly { month: string; churn_rate: number }
interface LtvUser      { user_id: string; cohort_month: string; ltv: number; is_pro: boolean }
interface CohortRow    { cohort: string; users: number; avgLtv: number; proCount: number }

const STAGES = ['🌱 Nuevo', '👀 Explorador', '🔥 Engaged', '💰 Hot Lead', '✅ Pro', '❌ Inactivo']
type Tab = 'usuarios' | 'seguimiento' | 'sesiones' | 'metricas'

// ── Strategy engine (Hormozi + Brunson) ──────────────────
function getStrategy(u: DashUser, pipe?: DashPipeline) {
    if (u.isPro && u.sessionCount < 3)
        return { label: '⚠️ Churn Alert', detail: 'Pro inactivo — llamada de onboarding urgente hoy', color: '#ef4444' }
    if (!u.isPro && u.sessionCount >= 10)
        return { label: '🚀 Power User', detail: 'Grand Slam Moment: upgrade inevitable — ofrécelo ahora', color: '#a855f7' }
    if (!u.isPro && u.sessionCount >= 5 && u.totalMinutes >= 10)
        return { label: '🔥 Listo para upgrade', detail: 'Alto engagement Free — proponer Pro con garantía de resultado', color: '#eab308' }
    if (u.sessionCount === 0 && !u.isPro)
        return { label: '😴 Usuario dormido', detail: 'Reactivación urgente — mensaje directo vía WhatsApp', color: '#f97316' }
    if (u.sessionCount === 1 && !u.isPro)
        return { label: '🌱 Recién llegado', detail: 'Nurturing: enviar guía de inicio rápido', color: '#22c55e' }
    if (pipe?.stage === '💰 Hot Lead')
        return { label: '💰 Cierre cerca', detail: 'Aplicar Brunson: "¿Qué te impide empezar hoy?" — llamar ahora', color: '#eab308' }
    return { label: '📊 Seguimiento normal', detail: 'Mantener contacto periódico y monitorear actividad', color: '#60a5fa' }
}

// ── Count-up hook ─────────────────────────────────────────
function useCountUp(target: number, duration = 1000) {
    const [val, setVal] = useState(0)
    useEffect(() => {
        if (target === 0) { setVal(0); return }
        let start = 0
        const step = target / (duration / 16)
        const timer = setInterval(() => {
            start += step
            if (start >= target) { setVal(target); clearInterval(timer) }
            else setVal(Math.floor(start))
        }, 16)
        return () => clearInterval(timer)
    }, [target, duration])
    return val
}

// ── Score Badge ───────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
    const color = score >= 70 ? '#22c55e' : score >= 35 ? '#eab308' : '#ef4444'
    return (
        <div className="relative w-9 h-9 shrink-0">
            <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90 absolute inset-0">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="3"
                    strokeDasharray={`${score} ${100 - score}`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style={{ color }}>{score}</span>
        </div>
    )
}

// ── Stat Card ─────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color, gradient }: {
    icon: string; label: string; value: number | string; sub: string; color: string; gradient: string
}) {
    const numVal = typeof value === 'number' ? value : parseInt(String(value).replace(/\D/g, '')) || 0
    const animated = useCountUp(numVal)
    const display = typeof value === 'string' && String(value).startsWith('$') ? `$${animated}` : (typeof value === 'number' ? animated : value)
    return (
        <motion.div whileHover={{ scale: 1.03, y: -2 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className="rounded-2xl p-4 relative overflow-hidden cursor-default"
            style={{ background: gradient, border: `1px solid ${color}25` }}>
            <div className="absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl opacity-20" style={{ background: color, transform: 'translate(20%, -20%)' }} />
            <div className="text-xl mb-2">{icon}</div>
            <div className="text-2xl font-black tracking-tight" style={{ color }}>{display}</div>
            <div className="text-[11px] font-semibold text-white/50 mt-0.5 uppercase tracking-wider">{label}</div>
            <div className="text-[10px] text-white/25 mt-1 leading-tight">{sub}</div>
        </motion.div>
    )
}

// ── AI Messenger Panel ────────────────────────────────────
function AIMessenger({ user, onClose }: { user: DashUser; onClose: () => void }) {
    const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp')
    const [goal, setGoal] = useState('Reactivación')
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(false)
    const goals = ['Reactivación', 'Upgrade Pro', 'Descuento especial', 'Check-in', 'Bienvenida']

    const generateMessage = async () => {
        if (!_genAI) { setMessage('Configura VITE_GEMINI_API_KEY en .env.local'); return }
        setLoading(true)
        try {
            const model = _genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' })
            const isWA = channel === 'whatsapp'
            const prompt = `Eres el asistente de ventas personal de Daniel, fundador de Vibepick (SaaS de sitios web con IA).

CLIENTE: ${user.name} | ${user.email} | ${user.isPro ? 'Pro' : 'Free'} | ${user.sessionCount} sesiones
OBJETIVO: ${goal} | CANAL: ${isWA ? 'WhatsApp' : 'Email'}

REGLAS: máximo ${isWA ? '3 líneas' : '5 líneas'}, no empezar con "Hola [Nombre]", sin viñetas, lenguaje natural, aplicar Hormozi (resultado, no características), un gancho al final.

${isWA ? 'Solo el mensaje de WhatsApp listo para copiar.' : 'ASUNTO: [asunto]\n\n[cuerpo]'}`
            const result = await model.generateContent(prompt)
            setMessage(result.response.text().trim())
        } catch (e: unknown) {
            const msg = (e as Error)?.message || ''
            if (msg.includes('429') || msg.includes('quota')) {
                setMessage('Cuota de API agotada. Espera 1 minuto.')
            } else {
                setMessage('Error al generar. Revisa VITE_GEMINI_API_KEY.')
            }
        }
        setLoading(false)
    }

    const sendViaWhatsApp = () => {
        let digits = user.phone.replace(/\D/g, '')
        if (digits.startsWith('0')) digits = digits.slice(1)
        if (digits.length === 10) digits = '57' + digits
        window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, '_blank')
    }

    const sendViaEmail = () => {
        let subject = 'Vibepick — mensaje para ti'
        let body = message
        if (message.startsWith('ASUNTO:')) {
            const parts = message.split('\n\n')
            subject = parts[0].replace('ASUNTO:', '').trim()
            body = parts.slice(1).join('\n\n')
        }
        window.open(`mailto:${user.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank')
    }

    return (
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="fixed right-0 top-0 h-full w-[380px] z-50 flex flex-col"
            style={{ background: '#080c18', borderLeft: '1px solid rgba(255,255,255,0.07)', paddingTop: '60px' }}>
            <div className="p-5 flex flex-col gap-4 flex-1 overflow-y-auto">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="font-bold text-white text-sm">{user.name}</p>
                        <p className="text-white/30 text-xs">{user.email}</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: 'rgba(255,255,255,0.5)', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '16px' }}>✕</button>
                </div>

                <div className="flex gap-2">
                    {(['whatsapp', 'email'] as const).map(c => (
                        <button key={c} onClick={() => setChannel(c)} style={{
                            flex: 1, padding: '8px', borderRadius: '10px', cursor: 'pointer',
                            border: channel === c ? '1px solid rgba(0,102,255,0.5)' : '1px solid rgba(255,255,255,0.06)',
                            background: channel === c ? 'rgba(0,102,255,0.15)' : 'rgba(255,255,255,0.03)',
                            color: channel === c ? '#fff' : 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: '0.8rem', fontFamily: 'inherit',
                        }}>{c === 'whatsapp' ? '📲 WhatsApp' : '📧 Email'}</button>
                    ))}
                </div>

                <div>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Objetivo</p>
                    <div className="flex flex-wrap gap-1.5">
                        {goals.map(g => (
                            <button key={g} onClick={() => setGoal(g)} style={{
                                padding: '5px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem',
                                border: goal === g ? '1px solid rgba(0,102,255,0.5)' : '1px solid rgba(255,255,255,0.07)',
                                background: goal === g ? 'rgba(0,102,255,0.2)' : 'rgba(255,255,255,0.03)',
                                color: goal === g ? '#fff' : 'rgba(255,255,255,0.4)', fontFamily: 'inherit',
                            }}>{g}</button>
                        ))}
                    </div>
                </div>

                <button onClick={generateMessage} disabled={loading} style={{
                    padding: '11px', borderRadius: '12px', border: 'none', cursor: loading ? 'wait' : 'pointer',
                    background: 'linear-gradient(135deg, #0066ff, #0ea5e9)', color: '#fff',
                    fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit', opacity: loading ? 0.7 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}>
                    {loading
                        ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                            style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%' }} />Generando con IA…</>
                        : '✨ Generar mensaje con IA'}
                </button>

                {message && (
                    <div>
                        <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Mensaje generado — edita si quieres</p>
                        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={7}
                            style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '12px', color: 'white', fontSize: '0.82rem', lineHeight: 1.6, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} />
                        <div className="flex gap-2 mt-2">
                            {channel === 'whatsapp'
                                ? <button onClick={sendViaWhatsApp} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', cursor: 'pointer', background: '#25D366', color: '#fff', fontWeight: 700, fontSize: '0.82rem', fontFamily: 'inherit' }}>📲 Abrir en WhatsApp</button>
                                : <button onClick={sendViaEmail} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', cursor: 'pointer', background: '#0066ff', color: '#fff', fontWeight: 700, fontSize: '0.82rem', fontFamily: 'inherit' }}>📧 Abrir en Email</button>}
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    )
}

// ── Client Card ───────────────────────────────────────────
function ClientCard({ u, pipe, score, onActivatePro, onOpenMessenger, onStageChange, onSaveNote }: {
    u: DashUser; pipe?: DashPipeline; score?: DashScore
    onActivatePro: (email: string) => void
    onOpenMessenger: (user: DashUser) => void
    onStageChange: (email: string, stage: string) => void
    onSaveNote: (email: string, note: string) => void
}) {
    const [expanded, setExpanded] = useState(false)
    const [note, setNote] = useState(pipe?.notes || '')
    const [savingPro, setSavingPro] = useState(false)
    const strategy = getStrategy(u, pipe)
    const currentStage = pipe?.stage ?? '🌱 Nuevo'

    return (
        <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="p-4 cursor-pointer" onClick={() => setExpanded(v => !v)}>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shrink-0"
                        style={{ background: `hsl(${u.name.charCodeAt(0) * 7 % 360}, 60%, 40%)` }}>
                        {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-white text-sm">{u.name}</p>
                            {u.isPro
                                ? <span className="text-[10px] px-2 py-0.5 rounded-full border font-semibold" style={{ background: 'rgba(234,179,8,0.15)', borderColor: 'rgba(234,179,8,0.3)', color: '#eab308' }}>⚡ Pro</span>
                                : <span className="text-[10px] text-white/25">Free</span>}
                        </div>
                        <p className="text-white/35 text-xs truncate">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {score && <ScoreBadge score={score.score} />}
                        <span className="text-white/25 text-sm">{expanded ? '▲' : '▼'}</span>
                    </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                        style={{ background: `${strategy.color}20`, color: strategy.color, border: `1px solid ${strategy.color}30` }}>
                        {strategy.label}
                    </span>
                    <span className="text-[11px] text-white/30 leading-tight">{strategy.detail}</span>
                </div>
            </div>

            <AnimatePresence>
                {expanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
                        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="p-4 flex flex-col gap-4">
                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { label: 'Sesiones', value: u.sessionCount, color: '#0066ff' },
                                    { label: 'Minutos', value: u.totalMinutes.toFixed(1), color: '#0ea5e9' },
                                    { label: 'Score', value: score?.score ?? 0, color: score ? (score.score >= 70 ? '#22c55e' : score.score >= 35 ? '#eab308' : '#ef4444') : '#666' }
                                ].map(s => (
                                    <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div className="text-xl font-black" style={{ color: s.color }}>{s.value}</div>
                                        <div className="text-[10px] text-white/25 uppercase tracking-wider mt-0.5">{s.label}</div>
                                    </div>
                                ))}
                            </div>

                            {u.phone && (
                                <a href={`tel:${u.phone}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#60a5fa', fontSize: '0.8rem', textDecoration: 'none' }}>
                                    📞 {u.phone}
                                </a>
                            )}

                            <div>
                                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Etapa del pipeline</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {STAGES.map(s => (
                                        <button key={s} onClick={() => onStageChange(u.email, s)} style={{
                                            padding: '4px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit',
                                            border: currentStage === s ? '1px solid rgba(0,102,255,0.5)' : '1px solid rgba(255,255,255,0.07)',
                                            background: currentStage === s ? 'rgba(0,102,255,0.2)' : 'rgba(255,255,255,0.03)',
                                            color: currentStage === s ? '#fff' : 'rgba(255,255,255,0.4)',
                                        }}>{s}</button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Notas del equipo</p>
                                <textarea value={note} onChange={e => setNote(e.target.value)}
                                    placeholder="Anota seguimiento, llamadas, acuerdos…" rows={2}
                                    style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '10px 12px', color: 'white', fontSize: '0.8rem', resize: 'none', outline: 'none', fontFamily: 'inherit' }} />
                                <button onClick={() => onSaveNote(u.email, note)}
                                    style={{ marginTop: '6px', padding: '5px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', fontFamily: 'inherit' }}>
                                    Guardar nota
                                </button>
                            </div>

                            <div className="flex gap-2 flex-wrap">
                                <button onClick={() => onOpenMessenger(u)} style={{
                                    flex: 1, padding: '9px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                                    background: 'linear-gradient(135deg, #0066ff22, #0ea5e922)', color: '#60a5fa',
                                    borderTop: '1px solid rgba(0,102,255,0.2)', fontSize: '0.8rem', fontWeight: 600,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                }}>🤖 Contactar con IA</button>
                                {!u.isPro && (
                                    <button onClick={async () => { setSavingPro(true); await onActivatePro(u.email); setSavingPro(false) }}
                                        disabled={savingPro} style={{
                                            flex: 1, padding: '9px', borderRadius: '10px', border: 'none', cursor: savingPro ? 'wait' : 'pointer', fontFamily: 'inherit',
                                            background: 'rgba(234,179,8,0.1)', color: '#eab308', borderTop: '1px solid rgba(234,179,8,0.2)',
                                            fontSize: '0.8rem', fontWeight: 600,
                                        }}>{savingPro ? '…' : '⚡ Activar Pro'}</button>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}

// ── Helpers ───────────────────────────────────────────────
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
function formatMonth(m: string) {
    const [yr, mo] = m.split('-')
    if (!yr || !mo) return m
    return `${MONTH_NAMES[parseInt(mo) - 1] ?? mo} ${yr.slice(2)}`
}

const LS_KEY = 'vp_crm_pipeline_v1'
function loadPipeline(): DashPipeline[] {
    try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') } catch { return [] }
}
function savePipeline(data: DashPipeline[]) {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
}

// ── Main Dashboard ────────────────────────────────────────
export default function Dashboard() {
    const [users,    setUsers]    = useState<DashUser[]>([])
    const [scores,   setScores]   = useState<DashScore[]>([])
    const [pipeline, setPipeline] = useState<DashPipeline[]>([])
    const [sessions, setSessions] = useState<DashSession[]>([])
    const [churnData, setChurnData] = useState<ChurnMonthly[]>([])
    const [ltvData,  setLtvData]  = useState<LtvUser[]>([])
    const [loading,  setLoading]  = useState(true)
    const [error,    setError]    = useState('')
    const [search,   setSearch]   = useState('')
    const [tab,      setTab]      = useState<Tab>('usuarios')
    const [messenger, setMessenger] = useState<DashUser | null>(null)

    const load = async () => {
        setLoading(true); setError('')
        try {
            const [{ data: usersRaw, error: usersErr }, { data: creditsRaw }] = await Promise.all([
                supabase.from('users').select('*').order('created_at', { ascending: false }),
                supabase.from('user_credits').select('user_id, credits'),
            ])
            if (usersErr) throw usersErr

            const creditsMap: Record<string, number> = {}
            for (const c of creditsRaw ?? []) creditsMap[c.user_id] = c.credits

            const mappedUsers: DashUser[] = (usersRaw ?? []).map(u => ({
                id: u.id as string,
                name: (`${u.first_name ?? ''} ${u.last_name ?? ''}`).trim() || (u.email as string),
                email: u.email as string,
                phone: (u.phone ?? '') as string,
                registeredAt: new Date(u.created_at as string).toLocaleDateString('es-CO'),
                isPro: (u.is_pro ?? false) as boolean,
                sessionCount: 0,
                totalMinutes: 0,
            }))

            const mappedScores: DashScore[] = mappedUsers.map(u => {
                const credits = creditsMap[u.id] ?? 0
                const score = u.isPro ? 75 : Math.min(Math.floor(credits * 5), 60)
                const nivel = score >= 70 ? '🟢 Activo' : score >= 35 ? '🟡 Potencial' : '🔴 En riesgo'
                return { email: u.email, score, nivel }
            })

            setUsers(mappedUsers)
            setScores(mappedScores)
            setPipeline(loadPipeline())
            setSessions([])

            const [churnResult, ltvResult] = await Promise.all([
                supabase.from('v_churn_rate_monthly').select('*').order('month', { ascending: true }).limit(6),
                supabase.from('v_ltv_per_user').select('*'),
            ])
            setChurnData((churnResult.data ?? []) as ChurnMonthly[])
            setLtvData((ltvResult.data ?? []) as LtvUser[])
        } catch (e: unknown) {
            setError((e as Error)?.message || 'Error al cargar datos de Supabase')
        }
        setLoading(false)
    }
    useEffect(() => {
        load()
        // Real-time: reload when any new user registers in the main app
        const channel = supabase
            .channel('crm_users_realtime')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'users' },
                () => { load() }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR')
                    console.warn('[CRM] Realtime subscription failed — manual refresh still works')
            })
        return () => { supabase.removeChannel(channel) }
    }, [])

    const getScore = (email: string) => scores.find(s => s.email === email)
    const getPipe  = (email: string) => pipeline.find(p => p.email === email)

    const filteredUsers = users
        .filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => b.totalMinutes - a.totalMinutes)

    const proUsers  = users.filter(u => u.isPro).length
    const hotLeads  = pipeline.filter(p => p.stage === '💰 Hot Lead').length
    const atRisk    = scores.filter(s => s.nivel === '🔴 En riesgo').length
    const mrr       = proUsers * 9
    const avgMin    = users.length ? Math.round(users.reduce((s, u) => s + u.totalMinutes, 0) / users.length) : 0
    const powerUsers = users.filter(u => !u.isPro && u.sessionCount >= 5)

    const STAT_CARDS = [
        { icon: '👥', label: 'Usuarios',      value: users.length, sub: 'Total registrados',         color: '#0066ff', gradient: 'linear-gradient(135deg, rgba(0,102,255,0.12), rgba(0,102,255,0.04))' },
        { icon: '⚡', label: 'Clientes Pro',  value: proUsers,     sub: 'Generando ingresos activos', color: '#22c55e', gradient: 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(34,197,94,0.04))' },
        { icon: '💰', label: 'Hot Leads',     value: hotLeads,     sub: 'Listos para upgrade',        color: '#eab308', gradient: 'linear-gradient(135deg, rgba(234,179,8,0.12), rgba(234,179,8,0.04))' },
        { icon: '🔴', label: 'En riesgo',     value: atRisk,       sub: 'Churn potencial',            color: '#ef4444', gradient: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))' },
        { icon: '💵', label: 'MRR',           value: mrr,          sub: 'Ingreso mensual recurrente', color: '#a855f7', gradient: 'linear-gradient(135deg, rgba(168,85,247,0.12), rgba(168,85,247,0.04))' },
        { icon: '⏱️', label: 'Min Promedio', value: avgMin,       sub: 'Engagement de la plataforma',color: '#06b6d4', gradient: 'linear-gradient(135deg, rgba(6,182,212,0.12), rgba(6,182,212,0.04))' },
    ]

    const TABS: { id: Tab; label: string }[] = [
        { id: 'usuarios',    label: '👥 Usuarios' },
        { id: 'seguimiento', label: '📊 Seguimiento' },
        { id: 'sesiones',    label: '⏱️ Sesiones' },
        { id: 'metricas',    label: '📈 Métricas' },
    ]

    // Churn
    const normalizeRate = (r: number) => r <= 1 ? r * 100 : r
    const churnChart = churnData.map(d => ({ month: formatMonth(d.month), churn: parseFloat(normalizeRate(d.churn_rate).toFixed(1)) }))
    const lastChurn  = churnData.length > 0 ? normalizeRate(churnData[churnData.length - 1].churn_rate) : null
    const prevChurn  = churnData.length > 1 ? normalizeRate(churnData[churnData.length - 2].churn_rate) : null
    const churnTrend = lastChurn !== null && prevChurn !== null ? (lastChurn > prevChurn ? 'up' : lastChurn < prevChurn ? 'down' : 'flat') : 'flat'

    // LTV
    const cohortMap: Record<string, { users: number; ltv: number; pro: number }> = {}
    for (const row of ltvData) {
        const k = row.cohort_month
        if (!cohortMap[k]) cohortMap[k] = { users: 0, ltv: 0, pro: 0 }
        cohortMap[k].users++; cohortMap[k].ltv += row.ltv
        if (row.is_pro) cohortMap[k].pro++
    }
    const cohortRows: CohortRow[] = Object.entries(cohortMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cohort, d]) => ({ cohort, users: d.users, avgLtv: d.ltv / d.users, proCount: d.pro }))
    const globalAvgLtv = ltvData.length ? ltvData.reduce((s, r) => s + r.ltv, 0) / ltvData.length : 0

    const avgDuration = sessions.length ? (sessions.reduce((a, s) => a + s.duration, 0) / sessions.length).toFixed(1) : '0'
    const thisWeekSessions = sessions.filter(s => { try { return new Date(s.date) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } catch { return false } })

    const handleActivatePro = async (email: string) => {
        await supabase.from('users').update({ is_pro: true }).eq('email', email)
        load()
    }
    const handleStageChange = (email: string, stage: string) => {
        setPipeline(prev => {
            const next = prev.find(p => p.email === email)
                ? prev.map(p => p.email === email ? { ...p, stage, updatedAt: new Date().toISOString() } : p)
                : [...prev, { email, name: users.find(u => u.email === email)?.name || '', stage, updatedAt: new Date().toISOString() }]
            savePipeline(next); return next
        })
    }
    const handleSaveNote = (email: string, note: string) => {
        setPipeline(prev => { const next = prev.map(p => p.email === email ? { ...p, notes: note } : p); savePipeline(next); return next })
    }

    return (
        <div className="min-h-screen text-white p-5 md:p-8" style={{ background: '#050810', fontFamily: "'Inter', sans-serif" }}>
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-extrabold tracking-tight">
                            Vibepick <span style={{ background: 'linear-gradient(90deg,#0066ff,#0ea5e9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>CRM</span>
                        </h1>
                        <p className="text-white/25 text-xs mt-0.5">Panel privado · {new Date().toLocaleDateString('es-CO')}</p>
                    </div>
                    <button onClick={load} disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold cursor-pointer border-none disabled:opacity-50"
                        style={{ background: 'rgba(0,102,255,0.2)', border: '1px solid rgba(0,102,255,0.3)' }}>
                        <motion.span animate={loading ? { rotate: 360 } : {}} transition={{ duration: 0.8, repeat: loading ? Infinity : 0, ease: 'linear' }}>↺</motion.span>
                        {loading ? 'Cargando…' : 'Actualizar'}
                    </button>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
                    {STAT_CARDS.map(c => <StatCard key={c.label} {...c} />)}
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-5 rounded-xl p-1 w-fit" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer border-none transition-all"
                            style={{ background: tab === t.id ? '#0066ff' : 'transparent', color: tab === t.id ? '#fff' : 'rgba(255,255,255,0.4)' }}>
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab === 'usuarios' && (
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por nombre o email…"
                        className="w-full max-w-sm rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none mb-5"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }} />
                )}

                {loading ? (
                    <div className="text-center py-20">
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                            style={{ width: 32, height: 32, border: '3px solid rgba(0,102,255,0.2)', borderTopColor: '#0066ff', borderRadius: '50%', margin: '0 auto 12px' }} />
                        <p className="text-white/25 text-sm">Cargando datos del CRM…</p>
                    </div>
                ) : error ? (
                    <div className="text-center py-20 text-red-400 text-sm">{error}</div>
                ) : (
                    <AnimatePresence mode="wait">
                        {/* Usuarios */}
                        {tab === 'usuarios' && (
                            <motion.div key="usuarios" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                                <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                    {filteredUsers.length === 0
                                        ? <p className="text-center py-16 text-white/20">No hay usuarios aún.</p>
                                        : <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                        {['Score','Usuario','Email','Teléfono','Sesiones','Tiempo','Etapa','Plan','Registro'].map(h => (
                                                            <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.25)' }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {filteredUsers.map((u, i) => {
                                                        const sc = getScore(u.email)
                                                        const pipe = getPipe(u.email)
                                                        return (
                                                            <motion.tr key={u.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                                                                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                                                                className="hover:bg-white/[0.02] transition-colors">
                                                                <td className="px-4 py-3"><ScoreBadge score={sc?.score ?? 0} /></td>
                                                                <td className="px-4 py-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                                                                            style={{ background: `hsl(${u.name.charCodeAt(0) * 7 % 360}, 60%, 40%)` }}>
                                                                            {u.name.charAt(0).toUpperCase()}
                                                                        </div>
                                                                        <span className="font-medium text-white truncate max-w-[120px]">{u.name}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3 text-xs truncate max-w-[160px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{u.email}</td>
                                                                <td className="px-4 py-3">
                                                                    {u.phone
                                                                        ? <a href={`tel:${u.phone}`} style={{ color: '#60a5fa', textDecoration: 'none', fontSize: '0.75rem' }}>{u.phone}</a>
                                                                        : <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.75rem' }}>—</span>}
                                                                </td>
                                                                <td className="px-4 py-3 font-bold text-white">{u.sessionCount}</td>
                                                                <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,0.6)' }}>{u.totalMinutes.toFixed(1)}<span style={{ color: 'rgba(255,255,255,0.25)' }}> min</span></td>
                                                                <td className="px-4 py-3">
                                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border" style={{ background: 'rgba(100,116,139,0.25)', color: '#94a3b8', borderColor: 'rgba(100,116,139,0.3)' }}>
                                                                        {pipe?.stage ?? '🌱 Nuevo'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    {u.isPro
                                                                        ? <span className="px-2 py-0.5 rounded-full text-[10px] border" style={{ background: 'rgba(234,179,8,0.15)', borderColor: 'rgba(234,179,8,0.3)', color: '#eab308' }}>⚡ Pro</span>
                                                                        : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem' }}>Free</span>}
                                                                </td>
                                                                <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>{u.registeredAt}</td>
                                                            </motion.tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>}
                                </div>
                            </motion.div>
                        )}

                        {/* Seguimiento */}
                        {tab === 'seguimiento' && (
                            <motion.div key="seguimiento" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                                {powerUsers.length > 0 && (
                                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                                        className="mb-4 p-4 rounded-2xl flex items-start gap-3"
                                        style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
                                        <span className="text-xl shrink-0">💡</span>
                                        <div>
                                            <p className="text-yellow-300 font-semibold text-sm">Oportunidad de upgrade detectada</p>
                                            <p className="text-yellow-300/60 text-xs mt-0.5">
                                                {powerUsers.length} usuario{powerUsers.length > 1 ? 's' : ''} Free con 5+ sesiones — aplicar estrategia "Grand Slam Moment" de Hormozi.
                                            </p>
                                        </div>
                                    </motion.div>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {users.length === 0
                                        ? <p className="text-white/20 text-sm col-span-3 text-center py-16">No hay usuarios registrados aún.</p>
                                        : [...users].sort((a, b) => b.sessionCount - a.sessionCount).map(u => (
                                            <ClientCard key={u.id} u={u} pipe={getPipe(u.email)} score={getScore(u.email)}
                                                onActivatePro={handleActivatePro} onOpenMessenger={setMessenger}
                                                onStageChange={handleStageChange} onSaveNote={handleSaveNote} />
                                        ))}
                                </div>
                            </motion.div>
                        )}

                        {/* Sesiones */}
                        {tab === 'sesiones' && (
                            <motion.div key="sesiones" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                                <div className="grid grid-cols-3 gap-3 mb-5">
                                    {[
                                        { label: 'Sesiones esta semana', value: thisWeekSessions.length, color: '#0066ff' },
                                        { label: 'Duración promedio',    value: `${avgDuration} min`,    color: '#0ea5e9' },
                                        { label: 'Total sesiones',       value: sessions.length,          color: '#a855f7' },
                                    ].map(s => (
                                        <div key={s.label} className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                            <div className="text-2xl font-black" style={{ color: s.color }}>{s.value}</div>
                                            <div className="text-[10px] uppercase tracking-wider mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>{s.label}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                    <p className="text-center py-16 text-white/20 text-sm">Aún no hay sesiones registradas en Supabase.</p>
                                </div>
                            </motion.div>
                        )}

                        {/* Métricas */}
                        {tab === 'metricas' && (
                            <motion.div key="metricas" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-8">
                                {/* Churn */}
                                <div>
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <h2 className="text-base font-bold text-white">Churn Rate Mensual</h2>
                                            <p className="text-[11px] text-white/30 mt-0.5">% usuarios sin actividad en los últimos 30 días</p>
                                        </div>
                                        {lastChurn !== null && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-3xl font-black" style={{ color: lastChurn >= 20 ? '#ef4444' : lastChurn >= 10 ? '#f97316' : '#22c55e' }}>
                                                    {lastChurn.toFixed(1)}%
                                                </span>
                                                {churnTrend !== 'flat' && (
                                                    <div className="flex flex-col items-center" style={{ color: churnTrend === 'up' ? '#ef4444' : '#22c55e' }}>
                                                        <span className="text-lg font-black leading-none">{churnTrend === 'up' ? '↑' : '↓'}</span>
                                                        <span className="text-[9px] font-semibold uppercase tracking-wider">{churnTrend === 'up' ? 'Sube' : 'Baja'}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                        {churnChart.length === 0
                                            ? <div className="flex flex-col items-center justify-center py-12 gap-2">
                                                <span className="text-2xl">📊</span>
                                                <p className="text-white/20 text-sm">Sin datos — vista <code className="text-white/30">v_churn_rate_monthly</code> pendiente</p>
                                            </div>
                                            : <ResponsiveContainer width="100%" height={220}>
                                                <BarChart data={churnChart} barCategoryGap="35%">
                                                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                                                    <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }} axisLine={false} tickLine={false} />
                                                    <YAxis tickFormatter={v => `${v}%`} tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                                                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                                                        content={({ active, payload, label }) => {
                                                            if (!active || !payload?.length) return null
                                                            const val = payload[0].value as number
                                                            return (
                                                                <div style={{ background: '#0f1628', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 14px' }}>
                                                                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem', marginBottom: 4 }}>{label}</p>
                                                                    <p style={{ color: val >= 20 ? '#ef4444' : val >= 10 ? '#f97316' : '#22c55e', fontWeight: 700, fontSize: '1rem' }}>{val.toFixed(1)}%</p>
                                                                </div>
                                                            )
                                                        }} />
                                                    <Bar dataKey="churn" radius={[6, 6, 0, 0]} fill="url(#churnGrad)" />
                                                    <defs>
                                                        <linearGradient id="churnGrad" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.9} />
                                                            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
                                                        </linearGradient>
                                                    </defs>
                                                </BarChart>
                                            </ResponsiveContainer>}
                                    </div>
                                </div>

                                {/* LTV */}
                                <div>
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <h2 className="text-base font-bold text-white">Lifetime Value por Cohorte</h2>
                                            <p className="text-[11px] text-white/30 mt-0.5">Agrupado por mes de registro</p>
                                        </div>
                                        {globalAvgLtv > 0 && (
                                            <div className="text-right">
                                                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">LTV Global Promedio</p>
                                                <p className="text-3xl font-black" style={{ color: '#a855f7' }}>${globalAvgLtv.toFixed(2)}</p>
                                            </div>
                                        )}
                                    </div>
                                    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        {cohortRows.length === 0
                                            ? <div className="flex flex-col items-center justify-center py-12 gap-2">
                                                <span className="text-2xl">💰</span>
                                                <p className="text-white/20 text-sm">Sin datos — vista <code className="text-white/30">v_ltv_per_user</code> pendiente</p>
                                            </div>
                                            : <div className="overflow-x-auto">
                                                <table className="w-full text-sm">
                                                    <thead>
                                                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                            {['Cohorte','Usuarios','LTV Promedio','% Pro'].map(h => (
                                                                <th key={h} className="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.25)' }}>{h}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {cohortRows.map((row, i) => {
                                                            const pctPro = row.users > 0 ? (row.proCount / row.users) * 100 : 0
                                                            return (
                                                                <motion.tr key={row.cohort} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
                                                                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                                                                    className="hover:bg-white/[0.02] transition-colors">
                                                                    <td className="px-5 py-3 font-semibold text-white">{formatMonth(row.cohort)}</td>
                                                                    <td className="px-5 py-3" style={{ color: 'rgba(255,255,255,0.5)' }}>{row.users}</td>
                                                                    <td className="px-5 py-3 font-bold" style={{ color: '#a855f7' }}>${row.avgLtv.toFixed(2)}</td>
                                                                    <td className="px-5 py-3">
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="flex-1 max-w-[80px] h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                                                                                <div className="h-full rounded-full" style={{ width: `${pctPro}%`, background: '#22c55e' }} />
                                                                            </div>
                                                                            <span className="text-xs font-semibold" style={{ color: '#22c55e' }}>{pctPro.toFixed(0)}%</span>
                                                                        </div>
                                                                    </td>
                                                                </motion.tr>
                                                            )
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                )}
            </div>

            <AnimatePresence>
                {messenger && (
                    <>
                        <motion.div key="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setMessenger(null)}
                            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 49 }} />
                        <AIMessenger key="messenger" user={messenger} onClose={() => setMessenger(null)} />
                    </>
                )}
            </AnimatePresence>
        </div>
    )
}
