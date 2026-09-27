/**
 * Wires notification taps and action buttons to `handleNotificationResponse`.
 *
 * Handles both ways a response can arrive:
 *  - the app is running → the listener fires;
 *  - the app was launched BY the tap → `getLastNotificationResponseAsync`.
 * Each response is handled once (keyed by notification + button + time), then cleared, so a
 * delivery repeated by the OS — or both paths firing — never applies an action twice.
 *
 * Native only: on the web build (used for runtime testing) there is nothing to listen to.
 * Verify on a development build; see README → Runtime verification.
 */
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import type { LoopService } from '@/services/loopService';
import { recordDevNotification } from '@/store/devNotificationLog';
import { flash } from '@/store/flash';

import { handleNotificationResponse, type Navigation } from './responses';

function navigate(target: Navigation): void {
  if (target === null) return;
  if ('home' in target) router.replace('/');
  else if (target.done) router.push({ pathname: '/loop/[id]', params: { id: target.loopId, done: '1' } });
  else router.push({ pathname: '/loop/[id]', params: { id: target.loopId } });
}

export function useNotificationResponses(service: LoopService): void {
  // The router must be mounted before we can navigate (a cold start delivers the response very early).
  const ready = Boolean(useRootNavigationState()?.key);

  useEffect(() => {
    if (Platform.OS === 'web' || !ready) return;
    const handledKeys = new Set<string>();

    const handle = async (response: Notifications.NotificationResponse) => {
      const key = `${response.notification.request.identifier}|${response.actionIdentifier}|${response.notification.date}`;
      if (handledKeys.has(key)) return;
      handledKeys.add(key);
      try {
        const data = response.notification.request.content.data as { loopId?: unknown } | undefined;
        const loopId = typeof data?.loopId === 'string' ? data.loopId : undefined;
        // Dev-only visibility into what the OS actually delivered, for the Native Test Lab. Dead
        // code in a production bundle — `__DEV__` is a compile-time constant Metro strips out.
        if (__DEV__) {
          recordDevNotification({
            loopId: loopId ?? null,
            categoryIdentifier: response.notification.request.content.categoryIdentifier ?? null,
            actionId: response.actionIdentifier,
            at: new Date().toISOString(),
          });
        }
        const outcome = await handleNotificationResponse(service, { actionId: response.actionIdentifier, loopId }, new Date());
        if (outcome.message) flash(outcome.message);
        navigate(outcome.navigate);
      } catch (error) {
        console.warn('Could not handle a notification response', error);
      } finally {
        await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => void handle(response));
    Notifications.getLastNotificationResponseAsync().then(
      (response) => {
        if (response) void handle(response);
      },
      () => undefined,
    );
    return () => subscription.remove();
  }, [service, ready]);
}
