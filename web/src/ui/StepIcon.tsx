// The arrow for one direction step (shared by the step list and the live banner).
import type { Step } from '../lib/directions'

const ICON_ROT: Partial<Record<Step['icon'], number>> = {
  straight: 0, 'slight-left': -45, 'slight-right': 45, left: -90, right: 90, 'sharp-left': -135, 'sharp-right': 135, uturn: 180,
}

export default function StepIcon({ icon, size = 16 }: { icon: Step['icon']; size?: number }) {
  if (icon === 'start') return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true"><circle cx="8" cy="8" r="4" fill="currentColor" /></svg>
  if (icon === 'arrive') return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true"><circle cx="8" cy="8" r="5" fill="var(--amber)" /></svg>
  if (icon === 'roundabout') return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true"><circle cx="8" cy="9" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 5V1M6 3l2-2 2 2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" style={{ transform: `rotate(${ICON_ROT[icon] ?? 0}deg)` }}>
      <path d="M8 14V3M4 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

