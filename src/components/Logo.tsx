import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'

export default function Logo({ className }: { className?: string }) {
  return (
    <motion.div
      className={cn('group flex items-center gap-2 select-none cursor-pointer', className)}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
    >
      <motion.div
        className="relative flex items-center justify-center h-full"
        animate={{ y: [-1, 2, -1] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.div
          className="absolute inset-0 bg-[#0077ff] rounded-full blur-xl"
          animate={{ opacity: [0.15, 0.4, 0.15], scale: [0.8, 1.1, 0.8] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <svg
          viewBox="0 0 100 80"
          className="relative z-10 h-full w-auto text-white"
          fill="currentColor"
        >
          <g transform="translate(0, 5)">
            <path d="M10 0 L40 70 A 5 5 0 0 0 49 70 L55 55 L32 0 Z" />
            <path d="M42 42 L85 42 A 8 8 0 0 0 93 34 L93 28 A 8 8 0 0 0 85 20 L55 20 L42 42 Z" />
          </g>
        </svg>
      </motion.div>
      <span
        className="font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-50 to-white tracking-tight"
        style={{ fontSize: 'max(1.2rem, 0.7em)', lineHeight: 1 }}
      >
        Vibepick
      </span>
    </motion.div>
  )
}
