import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { configureNotificationHandler } from '@/notifications';
import { useNotificationResponses } from '@/notifications/useNotificationResponses';
import { DatabaseProvider } from '@/store/database';
import { LanguageProvider, useLanguage } from '@/store/language';
import { ServicesProvider, useServices } from '@/store/services';
import { colors } from '@/theme';

// While the app is open, show reminders quietly as banners. Must run at module scope.
configureNotificationHandler();

/**
 * Runs once the database and services exist: reconciles OS reminders with the database (the OS
 * can forget them — reboots, restores) and listens for notification taps and buttons. Re-runs
 * whenever the UI language changes, so scheduled reminders and their categories follow the switch.
 */
function Bootstrap() {
  const { service, scheduler } = useServices();
  const { lang } = useLanguage();
  useEffect(() => {
    scheduler.resyncAll(new Date(), lang).catch((error) => console.warn('Reminder resync failed', error));
  }, [scheduler, lang]);
  useNotificationResponses(service);
  return null;
}

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <LanguageProvider>
        <ServicesProvider>
          <StatusBar style="dark" />
          <Bootstrap />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: 'fade_from_bottom',
            }}
          >
            <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
            <Stack.Screen name="review" options={{ presentation: 'modal' }} />
          </Stack>
        </ServicesProvider>
      </LanguageProvider>
    </DatabaseProvider>
  );
}
