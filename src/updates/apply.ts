import type { Loop } from '@/engine/types';
import type { ActionOutcome, LoopService } from '@/services/loopService';

import { rescheduleTarget } from './interpret';
import type { UpdateProposal } from './types';

/**
 * Carries out a confirmed proposal on the loop the user chose, through the same
 * `LoopService` every button uses — so it is transactional, updates reminders,
 * and writes the timeline (with the user's own words) like any other action.
 */
export async function applyProposal(
  service: LoopService,
  proposal: UpdateProposal,
  loop: Loop,
  now: Date,
): Promise<ActionOutcome> {
  const said = proposal.said;

  switch (proposal.intent) {
    case 'still_waiting':
      return service.perform(loop.id, 'still_waiting', { said });

    case 'dismiss':
      return service.perform(loop.id, 'dismiss', { said });

    case 'reschedule': {
      const at = rescheduleTarget(proposal.when, loop, now);
      if (!at) throw new Error('There is no future time to move it to');
      return service.reschedule(loop.id, at, said);
    }

    case 'resolve': {
      switch (loop.type) {
        case 'waiting':
          return service.perform(loop.id, 'got_reply', { said });
        case 'promise':
          return service.perform(loop.id, 'fulfilled', { said });
        case 'event':
          return service.perform(loop.id, 'done', { said });
        case 'task': {
          // A follow-up completes straight away; an ordinary task means "yes, it ends here" — the user just told us so.
          const first = await service.perform(loop.id, 'done', { said });
          return first.ask ? service.finishTask(loop.id, { endsHere: true, said }) : first;
        }
        default:
          return service.perform(loop.id, 'resolve', { said });
      }
    }
  }
}
