// Depth in words people feel, against a typical adult (about 1.65 m). The number stays beside it.
const FEEL: [number, string][] = [
  [5, 'Dry'], [15, 'Ankle-deep'], [35, 'Shin-deep'], [60, 'Knee-deep'], [90, 'Thigh-deep'],
  [115, 'Waist-deep'], [140, 'Chest-deep'], [165, 'Shoulder-deep'], [Infinity, "Over an adult's head"],
]
export function depthFeel(cm: number): string {
  return (FEEL.find(([max]) => cm < max) ?? FEEL[FEEL.length - 1])[1]
}
