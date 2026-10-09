// Runtime configuration. In production these point at CloudFront and API Gateway.
export const DATA_BASE: string = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? '/data'
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export const DOMAIN_BBOX: [number, number, number, number] = [80.1, 12.85, 80.33, 13.24]
export const VELACHERY: [number, number] = [80.21951, 12.96762]   // same point the search box returns for 'Velachery'

export const TOKENS = {
  stormSky: '#14303D',
  wetAsphalt: '#3E5560',
  shallow: '#86E6EC',      // brighter than the spec token so shallow water reads on the darker city
  deep: '#1E7BC6',         // more saturated: deep water is the boldest element
  amber: '#F2A541',
  rainGrey: '#C9D4D8',
}

export const DESIGN_TOTALS = [50, 100, 150, 200, 300, 400]

export const REPLAYS = [
  { run: 'dec2015_reservoir', label: '2015 floods', short: '2015', line: 'The Dec 2015 floods' },
  { run: 'michaung2023', label: 'Cyclone Michaung, 2023', short: 'Michaung 2023', line: 'Cyclone Michaung 2023' },
  { run: 'fengal2024', label: 'Cyclone Fengal, 2024', short: 'Fengal 2024', line: 'Cyclone Fengal 2024' },
] as const

export const BANDS = [
  { max: 5, code: 'dry', label: 'Dry' },
  { max: 15, code: 'wet', label: 'Wet but passable' },
  { max: 30, code: 'unsafe_two_wheeler', label: 'Unsafe for two-wheelers' },
  { max: Infinity, code: 'unsafe_car', label: 'Unsafe for cars' },
] as const

export function bandFor(cm: number) {
  return BANDS.find((b) => cm < b.max) ?? BANDS[BANDS.length - 1]
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
