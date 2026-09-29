import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { LoopRow } from '@/components/LoopRow';
import { Screen } from '@/components/Screen';
import { listOpenLoops } from '@/db/loops';
import type { Loop } from '@/engine/types';
import { useChangeVersion } from '@/store/changes';
import { useDatabase } from '@/store/database';
import { useLanguage } from '@/store/language';
import { spacing } from '@/theme';
import { formatDateLabel } from '@/utils/format';

/** A chronological view of OpenLoop reminders, deliberately not a full calendar. */
export default function Timeline() {
  const db = useDatabase(); const version = useChangeVersion(); const { lang } = useLanguage();
  const [loops, setLoops] = useState<Loop[]>([]); const now = useMemo(() => new Date(), [version]);
  useFocusEffect(useCallback(() => { let current = true; listOpenLoops(db).then((items) => current && setLoops(items)); return () => { current = false; }; }, [db, version]));
  const groups = useMemo(() => {
    const items = new Map<string, Loop[]>();
    for (const loop of loops) { const key = loop.nextReviewAt ? loop.nextReviewAt.slice(0, 10) : 'later'; items.set(key, [...(items.get(key) ?? []), loop]); }
    return [...items.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [loops]);
  return <Screen scroll footer={<Button label={lang === 'tr' ? 'Geri' : 'Back'} variant="secondary" onPress={() => router.back()} />}>
    <AppText variant="title">{lang === 'tr' ? 'Zaman görünümü' : 'Time view'}</AppText>
    <AppText tone="muted" style={styles.intro}>{lang === 'tr' ? 'Yalnızca geri gelecek açık konular.' : 'Only open things that will come back.'}</AppText>
    {groups.map(([day, items]) => <View key={day} style={styles.group}><AppText variant="label" tone="muted">{day === 'later' ? (lang === 'tr' ? 'DAHA SONRA' : 'LATER') : formatDateLabel(new Date(`${day}T12:00:00`), now, lang).toUpperCase()}</AppText>{items.map((loop) => <LoopRow key={loop.id} loop={loop} now={now} lang={lang} onPress={() => router.push({ pathname: '/loop/[id]', params: { id: loop.id } })} />)}</View>)}
    {!groups.length ? <AppText tone="muted" style={styles.group}>{lang === 'tr' ? 'Şimdilik zamanlanmış açık konu yok.' : 'Nothing open is scheduled yet.'}</AppText> : null}
  </Screen>;
}
const styles = StyleSheet.create({ intro: { marginTop: spacing.sm }, group: { gap: spacing.sm, marginTop: spacing.xl } });
