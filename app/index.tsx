import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { FlashBanner } from '@/components/FlashBanner';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LoopRow } from '@/components/LoopRow';
import { Screen } from '@/components/Screen';
import { groupForHome, summarizeHome, type HomeSection } from '@/engine/sections';
import type { Loop } from '@/engine/types';
import { strings } from '@/i18n';
import { useChangeVersion } from '@/store/changes';
import { useLanguage } from '@/store/language';
import { useLoopService } from '@/store/services';
import { spacing } from '@/theme';

const SECTION_KEYS: HomeSection[] = ['needs_you', 'waiting', 'coming_up', 'bring_back_later'];

export default function Home() {
  const service = useLoopService();
  const version = useChangeVersion();
  const { lang } = useLanguage();
  const s = strings(lang);
  const [loops, setLoops] = useState<Loop[] | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Reload when Home comes back into focus, and whenever any loop changed (even from a notification button).
  useFocusEffect(
    useCallback(() => {
      void version; // a change anywhere re-creates this callback, which re-runs the focus effect
      let current = true;
      service.listOpen().then(
        (open) => {
          if (!current) return;
          setLoops(open);
          setNow(new Date());
        },
        (error) => console.warn('Could not load loops', error),
      );
      return () => {
        current = false;
      };
    }, [service, version]),
  );

  const groups = loops ? groupForHome(loops, now) : null;
  const summary = groups ? summarizeHome(groups, lang) : '';
  const empty = groups !== null && summary === '' && groups.bring_back_later.length === 0;

  return (
    <Screen scroll footer={<Button testID="capture-cta" label={s.home.cta} onPress={() => router.push('/capture')} />}>
      <View style={styles.header}>
        <AppText variant="title">{s.home.title}</AppText>
        <LanguageSwitch />
      </View>
      {summary ? (
        <AppText tone="muted" style={styles.summary} testID="summary">
          {summary}
        </AppText>
      ) : null}
      <FlashBanner />

      {empty ? (
        <View style={styles.empty}>
          <AppText variant="heading">{s.home.emptyHeading}</AppText>
          <AppText tone="muted">{s.home.emptyBody}</AppText>
        </View>
      ) : null}

      {groups
        ? SECTION_KEYS.map((key) =>
            groups[key].length > 0 ? (
              <View key={key} style={styles.section} testID={`section-${key}`}>
                <AppText variant="label" tone="muted">
                  {s.home.sections[key]}
                </AppText>
                {groups[key].map((loop) => (
                  <LoopRow
                    key={loop.id}
                    loop={loop}
                    now={now}
                    lang={lang}
                    onPress={() => router.push({ pathname: '/loop/[id]', params: { id: loop.id } })}
                  />
                ))}
              </View>
            ) : null,
          )
        : null}

      {/* DEV build only — Metro strips this block from a production bundle. */}
      {__DEV__ ? (
        <Pressable onPress={() => router.push('/dev-lab')} style={styles.devLink} testID="dev-lab-link">
          <AppText variant="caption" tone="muted">
            Dev: Native Test Lab
          </AppText>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  summary: { marginTop: spacing.xs },
  empty: { marginTop: spacing.huge, gap: spacing.md },
  section: { marginTop: spacing.xxl, gap: spacing.sm },
  devLink: { marginTop: spacing.xxl, alignSelf: 'center' },
});
