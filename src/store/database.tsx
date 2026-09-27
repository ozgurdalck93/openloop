import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { getDatabase } from '@/db';
import type { Db } from '@/db/types';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { colors, spacing } from '@/theme';

const DatabaseContext = createContext<Db | null>(null);

/**
 * Opens and migrates the database before anything renders, so no screen ever
 * has to handle "the database isn't ready". If opening fails, say so calmly and
 * offer a retry rather than showing a blank screen.
 */
export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    getDatabase().then(
      (opened) => current && setDb(opened),
      (e: unknown) => current && setError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  const retry = () => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  if (db) return <DatabaseContext.Provider value={db}>{children}</DatabaseContext.Provider>;

  return (
    <View style={styles.center}>
      {error ? (
        <>
          <AppText variant="heading">Couldn’t open your loops</AppText>
          <AppText tone="muted" style={styles.message}>
            {error.message}
          </AppText>
          <Button label="Try again" onPress={retry} />
        </>
      ) : (
        <ActivityIndicator color={colors.muted} />
      )}
    </View>
  );
}

export function useDatabase(): Db {
  const db = useContext(DatabaseContext);
  if (!db) throw new Error('useDatabase must be used inside <DatabaseProvider>');
  return db;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  message: { textAlign: 'center', marginBottom: spacing.md },
});
