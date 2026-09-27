import type { LoopType } from '@/engine/types';

interface LoopTypeMeta {
  /** Badge text as shown in the UI (03_OPENLOOP_UX_FLOW.md). */
  label: string;
  /** Muted earth-tone used for the badge text. */
  color: string;
  /** Very light tint of the same hue, for the badge background. */
  tint: string;
}

export const loopTypeMeta: Record<LoopType, LoopTypeMeta> = {
  task: { label: 'TASK', color: '#3F6B57', tint: '#E3ECE6' },
  waiting: { label: 'WAITING', color: '#8F6224', tint: '#F3E9D8' },
  event: { label: 'EVENT', color: '#48647A', tint: '#E1E9EF' },
  promise: { label: 'PROMISE', color: '#9A4F3B', tint: '#F2E2DC' },
  return_later: { label: 'RETURN LATER', color: '#66733A', tint: '#E8ECD8' },
  reference: { label: 'REFERENCE', color: '#767063', tint: '#ECE8DF' },
};
