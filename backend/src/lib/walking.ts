import type { WalkingProfile } from '../../../shared/walking';
export { walkSecondsForPath, walkingSpeed } from '../../../shared/walking';
/**
 * Update the learned factor after a trip ("that took longer than you said").
 * Moves gently so one odd trip doesn't swing future estimates much.
 */
export function learn(profile: WalkingProfile, feedback: 'faster' | 'right' | 'slower'): WalkingProfile {
  const target = feedback === 'faster' ? 0.85 : feedback === 'slower' ? 1.2 : 1
  const next = profile.learnedFactor * (1 + (target - 1) * 0.3)
  return { ...profile, learnedFactor: Math.min(2, Math.max(0.5, Number(next.toFixed(3)))) }
}
