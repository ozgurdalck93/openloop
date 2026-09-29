import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { LoopRow } from '@/components/LoopRow';
import { Screen } from '@/components/Screen';
import { listLoops } from '@/db/loops';
import { CLOSED_STATUSES, type Loop } from '@/engine/types';
import { strings } from '@/i18n';
import { useDatabase } from '@/store/database';
import { useChangeVersion } from '@/store/changes';
import { useLanguage } from '@/store/language';
import { colors, hairline, radius, spacing, typography } from '@/theme';
import { fold } from '@/utils/fold';

type Tab = 'all' | 'people' | 'history' | 'references';

/** Search, people/company memory, completed history and saved reference notes in one calm place. */
export default function Browse() {
  const db = useDatabase();
  const version = useChangeVersion();
  const { lang } = useLanguage();
  const s = strings(lang);
  const [loops, setLoops] = useState<Loop[]>([]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [entity, setEntity] = useState<string | null>(null);
  const now = useMemo(() => new Date(), [version]);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      listLoops(db).then((items) => current && setLoops(items), (error) => console.warn('Could not browse loops', error));
      return () => {
        current = false;
      };
    }, [db, version]),
  );

  const people = useMemo(() => {
    const names = new Map<string, string>();
    for (const loop of loops) {
      if (loop.entityName?.trim()) names.set(fold(loop.entityName), loop.entityName.trim());
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b, lang));
  }, [loops, lang]);

  const visible = useMemo(() => {
    const needle = fold(query.trim());
    return loops.filter((loop) => {
      if (entity && fold(loop.entityName ?? '') !== fold(entity)) return false;
      if (tab === 'people' && !entity) return false;
      if (tab === 'history' && !CLOSED_STATUSES.includes(loop.status)) return false;
      if (tab === 'references' && loop.type !== 'reference') return false;
      if (!needle) return tab !== 'all' || loop.type !== 'reference';
      return fold(`${loop.title} ${loop.entityName ?? ''} ${loop.rawContext ?? ''}`).includes(needle);
    });
  }, [entity, loops, query, tab]);

  const chooseTab = (next: Tab) => {
    setTab(next);
    if (next !== 'people') setEntity(null);
  };

  return (
    <Screen scroll footer={<Button label={s.back} variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}>
      <AppText variant="title">{s.browse.title}</AppText>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={s.browse.searchPlaceholder}
        placeholderTextColor={colors.muted}
        style={styles.search}
        accessibilityLabel={s.browse.searchPlaceholder}
      />
      <View style={styles.tabs}>
        {(['all', 'people', 'history', 'references'] as const).map((item) => (
          <Pressable key={item} onPress={() => chooseTab(item)} style={[styles.tab, tab === item && styles.selected]}>
            <AppText variant="caption" style={{ color: tab === item ? colors.onAccent : colors.ink }}>
              {s.browse[item]}
            </AppText>
          </Pressable>
        ))}
      </View>

      {tab === 'people' && !entity ? (
        <View style={styles.people}>
          {people.map((name) => {
            const count = loops.filter((loop) => fold(loop.entityName ?? '') === fold(name) && !CLOSED_STATUSES.includes(loop.status)).length;
            return (
              <Pressable key={name} onPress={() => setEntity(name)} style={styles.person}>
                <AppText variant="bodyStrong">{name}</AppText>
                <AppText variant="caption" tone="muted">{s.browse.openCount(count)}</AppText>
              </Pressable>
            );
          })}
          {people.length === 0 ? <AppText tone="muted">{s.browse.noResults}</AppText> : null}
        </View>
      ) : (
        <View style={styles.results}>
          {entity ? (
            <Pressable onPress={() => setEntity(null)}><AppText variant="caption" tone="accent">‹ {s.browse.clearPerson}: {entity}</AppText></Pressable>
          ) : null}
          {visible.map((loop) => (
            <LoopRow key={loop.id} loop={loop} now={now} lang={lang} onPress={() => router.push({ pathname: '/loop/[id]', params: { id: loop.id } })} />
          ))}
          {visible.length === 0 ? <AppText tone="muted">{s.browse.noResults}</AppText> : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { marginTop: spacing.xl, minHeight: 48, borderWidth: hairline, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.ink, backgroundColor: colors.surface, ...typography.body },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: hairline, borderColor: colors.borderStrong },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  people: { gap: spacing.sm, marginTop: spacing.xl },
  person: { padding: spacing.lg, gap: spacing.xs, borderWidth: hairline, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  results: { gap: spacing.sm, marginTop: spacing.xl },
});
