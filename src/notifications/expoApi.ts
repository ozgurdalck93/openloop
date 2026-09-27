/**
 * The production `NotificationsApi`: expo-notifications, and nothing else. Local
 * notifications work in Expo Go; interactive action buttons and background delivery
 * should be verified on a development build (see README → Runtime verification).
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { UiLang } from '@/i18n';

import { CATEGORY_IDS, DEFAULT_TAP_ACTION, categoryActionsFor, type NotificationCategoryKey } from './categories';
import type { NotificationsApi } from './scheduler';

export const ANDROID_CHANNEL_ID = 'loops';

// Guard against the constant drifting between expo-notifications versions.
if (Notifications.DEFAULT_ACTION_IDENTIFIER !== DEFAULT_TAP_ACTION) {
  console.warn('expo-notifications changed its default tap identifier; update DEFAULT_TAP_ACTION');
}

const SUPPORTED = Platform.OS !== 'web';

/** While the app is open, show reminders quietly as banners. Call once, at module scope. */
export function configureNotificationHandler(): void {
  if (!SUPPORTED) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// Categories are registered per language, since the OS bakes the button titles in at
// registration time; switching the UI language re-registers them the next time a
// reminder is synced.
let setUpForLang: UiLang | null = null;
let setUpOnce: Promise<void> | null = null;

export const expoNotificationsApi: NotificationsApi = {
  supported: SUPPORTED,

  async getPermission() {
    const p = await Notifications.getPermissionsAsync();
    return { granted: p.granted, canAskAgain: p.canAskAgain };
  },

  async requestPermission() {
    const asked = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    return asked.granted;
  },

  setUp(lang: UiLang = 'en') {
    if (!SUPPORTED) return Promise.resolve();
    if (setUpForLang !== lang) setUpOnce = null; // the OS bakes button titles in at registration; a language switch re-registers
    if (!setUpOnce) {
      setUpForLang = lang;
      const actions = categoryActionsFor(lang);
      setUpOnce = (async () => {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
            name: 'Loop reminders',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }
        for (const key of Object.keys(actions) as NotificationCategoryKey[]) {
          await Notifications.setNotificationCategoryAsync(
            CATEGORY_IDS[key],
            actions[key].map((action) => ({
              identifier: action.id,
              buttonTitle: action.title,
              options: { opensAppToForeground: action.opensApp },
            })),
          );
        }
      })().catch((error) => {
        setUpOnce = null; // allow a retry
        setUpForLang = null;
        throw error;
      });
    }
    return setUpOnce;
  },

  schedule: (request) =>
    Notifications.scheduleNotificationAsync({
      content: {
        title: request.title,
        body: request.body,
        data: request.data,
        categoryIdentifier: request.categoryIdentifier,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: request.fireAt,
        channelId: ANDROID_CHANNEL_ID,
      },
    }),

  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
};
