import type { NotificationsApi, ScheduleRequest } from '@/notifications/scheduler';

/**
 * An in-memory stand-in for the OS notification system. It records exactly what the
 * app schedules and cancels, so tests can assert on "what would the phone show?".
 * Control its behaviour through `state`.
 */
export function createFakeNotifications() {
  const scheduled = new Map<string, ScheduleRequest>();
  let counter = 0;
  const state = {
    supported: true,
    granted: true,
    canAskAgain: true,
    /** What a permission prompt answers. */
    userAllowsWhenAsked: true,
    failSchedule: false,
    failCancel: false,
    setUpCalls: 0,
    requestCalls: 0,
    cancelled: [] as string[],
  };

  const api: NotificationsApi = {
    get supported() {
      return state.supported;
    },
    async getPermission() {
      return { granted: state.granted, canAskAgain: state.canAskAgain };
    },
    async requestPermission() {
      state.requestCalls += 1;
      if (state.userAllowsWhenAsked) state.granted = true;
      state.canAskAgain = false;
      return state.granted;
    },
    async setUp() {
      state.setUpCalls += 1;
    },
    async schedule(request) {
      if (state.failSchedule) throw new Error('the OS refused to schedule');
      counter += 1;
      const id = `os-${counter}`;
      scheduled.set(id, request);
      return id;
    },
    async cancel(id) {
      if (state.failCancel) throw new Error('the OS refused to cancel');
      state.cancelled.push(id);
      scheduled.delete(id);
    },
  };

  return {
    api,
    state,
    scheduled,
    /** Everything currently scheduled for one loop. */
    forLoop: (loopId: string) => [...scheduled.entries()].filter(([, r]) => r.data.loopId === loopId),
  };
}

export type FakeNotifications = ReturnType<typeof createFakeNotifications>;
