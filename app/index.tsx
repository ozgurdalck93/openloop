import { router, useFocusEffect } from 'expo-router';
import * as StoreReview from 'expo-store-review';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { FlashBanner } from '@/components/FlashBanner';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LoopRow } from '@/components/LoopRow';
import { Screen } from '@/components/Screen';
import { listLoops } from '@/db/loops';
import { getSetting } from '@/db/settings';
import { groupForHome, summarizeHome, type HomeSection } from '@/engine/sections';
import type { Loop } from '@/engine/types';
import { strings } from '@/i18n';
import { weeklyCheckIn } from '@/insights/weekly';
import { useChangeVersion } from '@/store/changes';
import { useDatabase } from '@/store/database';
import { useLanguage } from '@/store/language';
import { useLoopService } from '@/store/services';
import { spacing } from '@/theme';

const SECTION_KEYS: HomeSection[] = ['needs_you', 'waiting', 'coming_up', 'bring_back_later'];

export default function Home() {
  const service = useLoopService();
  const db = useDatabase();
  const version = useChangeVersion();
  const { lang } = useLanguage();
  const s = strings(lang);
  const [loops, setLoops] = useState<Loop[] | null>(null);
  const [allLoops, setAllLoops] = useState<Loop[] | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Reload when Home comes back into focus, and whenever any loop changed (even from a notification button).
  useFocusEffect(
    useCallback(() => {
      void version; // a change anywhere re-creates this callback, which re-runs the focus effect
      let current = true;
      Promise.all([service.listOpen(), listLoops(db)]).then(
        ([open, all]) => {
          if (!current) return;
          setLoops(open);
          setAllLoops(all);
          setNow(new Date());
        },
        (error) => console.warn('Could not load loops', error),
      );
      return () => {
        current = false;
      };
    }, [db, service, version]),
  );

  // First launch: show the short welcome once.
  useEffect(() => {
    let current = true;
    getSetting(db, 'onboarded').then(
      (value) => {
        if (current && value === null) router.replace('/welcome');
      },
      (error) => console.warn('Could not read the welcome flag', error),
    );
    return () => {
      current = false;
    };
  }, [db]);

  const groups = loops ? groupForHome(loops, now) : null;
  const summary = groups ? summarizeHome(groups, lang) : '';
  const empty = groups !== null && summary === '' && groups.bring_back_later.length === 0;
  const weekly = allLoops ? weeklyCheckIn(allLoops, now) : null;
  const rateApp = async () => {
    if (await StoreReview.isAvailableAsync()) await StoreReview.requestReview();
  };

  return (
    <Screen
      scroll
      footer={
        <View style={styles.footer}>
          <Button testID="capture-cta" label={s.home.cta} onPress={() => router.push('/capture')} />
          <Button label={s.browse.cta} variant="secondary" onPress={() => router.push('/browse')} />
          <Pressable accessibilityRole="button" onPress={() => router.push('/timeline')} style={styles.rate}>
            <AppText variant="caption" tone="muted">{lang === 'tr' ? 'Zaman görünümü' : 'Time view'}</AppText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push('/data')} style={styles.rate}>
            <AppText variant="caption" tone="muted">{lang === 'tr' ? 'Verilerim ve yedek' : 'My data & backup'}</AppText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void rateApp()} style={styles.rate}>
            <AppText variant="caption" tone="muted">{s.home.rate}</AppText>
          </Pressable>
        </View>
      }
    >
      <View style={styles.header}>
        <AppText variant="title">{s.home.title}</AppText>
        <View style={styles.headerActions}>
          <Pressable testID="open-settings" accessibilityRole="button" accessibilityLabel={lang === 'tr' ? 'Ayarlar' : 'Settings'} onPress={() => router.push('/settings')} style={styles.settingsBtn}>
            <AppText variant="caption" tone="muted">{lang === 'tr' ? 'Ayarlar' : 'Settings'}</AppText>
          </Pressable>
          <LanguageSwitch />
        </View>
      </View>
      {summary ? (
        <AppText tone="muted" style={styles.summary} testID="summary">
          {summary}
        </AppText>
      ) : null}
      <FlashBanner />

      {groups ? (
        <View style={styles.daily}>
          <AppText variant="label" tone="muted">{s.daily.title}</AppText>
          <AppText tone="muted">
            {summary ? s.daily.active(groups.needs_you.length + groups.waiting.length + groups.coming_up.length) : s.daily.quiet}
          </AppText>
        </View>
      ) : null}
      {weekly ? (
        <View style={styles.weekly}>
          <AppText variant="label" tone="muted">{lang === 'tr' ? 'SON 7 GÜN' : 'LAST 7 DAYS'}</AppText>
          <AppText tone="muted">
            {lang === 'tr'
              ? `${weekly.closed} konu kapandı · ${weekly.waiting} konu beklemede · ${weekly.needsAttention} konu sana kaldı`
              : `${weekly.closed} closed · ${weekly.waiting} waiting · ${weekly.needsAttention} need you`}
          </AppText>
        </View>
      ) : null}

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
  headerActions: { alignItems: 'flex-end', gap: spacing.sm },
  settingsBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  summary: { marginTop: spacing.xs },
  empty: { marginTop: spacing.huge, gap: spacing.md },
  section: { marginTop: spacing.xxl, gap: spacing.sm },
  daily: { marginTop: spacing.xl, gap: spacing.xs },
  weekly: { marginTop: spacing.lg, gap: spacing.xs },
  footer: { gap: spacing.sm },
  rate: { alignSelf: 'center', padding: spacing.sm },
  devLink: { marginTop: spacing.xxl, alignSelf: 'center' },
});
