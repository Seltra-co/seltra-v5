//seltra-web/frontend/components/storefront/sections/TeamProfiles.tsx
'use client'
import { motion } from 'framer-motion'
import Image from 'next/image'

export interface TeamMember { name: string; role: string; bio?: string; photoUrl?: string }

const DEFAULT: TeamMember[] = [
  { name: 'Team Lead', role: 'Founder', bio: 'Sets the standard for every order that goes out.' },
  { name: 'Specialist', role: 'Operations', bio: 'Keeps things running on time, every time.' },
]

export function TeamProfiles({ headline = 'Meet the team', members }: { headline?: string; members?: TeamMember[] }) {
  const list = members?.length ? members : DEFAULT
  return (
    <section className="storefront-section border-t" style={{ borderColor: 'var(--store-border)' }}>
      <h2 className="store-heading mb-8 text-[clamp(1.75rem,3.5vw,2.5rem)] font-black text-balance">{headline}</h2>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((member, i) => (
          <motion.div
            key={`${member.name}-${i}`}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, delay: i * 0.06 }}
            className="flex flex-col gap-3"
          >
            <div
              className="relative aspect-square overflow-hidden"
              style={{ borderRadius: 'var(--store-radius-card)', background: 'var(--store-accent-soft)' }}
            >
              {member.photoUrl ? (
                <Image src={member.photoUrl} alt={member.name} fill className="object-cover" sizes="(max-width:640px) 50vw, 33vw" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="text-3xl font-bold opacity-20" style={{ fontFamily: 'var(--store-heading-font), serif', color: 'var(--store-accent)' }}>
                    {member.name.slice(0, 2).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--store-text)' }}>{member.name}</h3>
              <span className="store-eyebrow" style={{ color: 'var(--store-accent)' }}>{member.role}</span>
              {member.bio && <p className="mt-1 text-[0.8rem] leading-relaxed" style={{ color: 'var(--store-muted)' }}>{member.bio}</p>}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}