import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import { PRIVACY_URL } from '@/config/links';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { listLoops } from '@/db/loops';
import type { Loop } from '@/engine/types';
import { useDatabase } from '@/store/database';
import { useLanguage } from '@/store/language';
import { spacing } from '@/theme';

const asCsv =(loops: readonly Loop[]) => ['title,type,status,person_or_company,next_review_at,created_at,resolved_at,note', ...loops.map((loop) => [loop.title, loop.type, loop.status, loop.entityName, loop.nextReviewAt, loop.createdAt, loop.resolvedAt, loop.rawContext].map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');

export default function DataScreen() {
  const db = useDatabase(); const { lang } = useLanguage(); const [loops, setLoops] = useState<Loop[]>([]);
  useFocusEffect(useCallback(() => { let current = true; listLoops(db).then((items) => current && setLoops(items)); return () => { current = false; }; }, [db]));
  const share = (format: 'json' | 'csv') => void Share.share({ title: 'OpenLoop backup', message: format === 'json' ? JSON.stringify({ exportedAt: new Date().toISOString(), loops }, null, 2) : asCsv(loops) });
  return <Screen footer={<Button label={lang === 'tr' ? 'Geri' : 'Back'} variant="secondary" onPress={() => router.back()} />}><AppText variant="title">{lang === 'tr' ? 'Verilerin' : 'Your data'}</AppText><View style={styles.body}><AppText tone="muted">{lang === 'tr' ? 'Verilerin cihazında kalır. İstersen bir kopyasını paylaşabilir ve saklayabilirsin.' : 'Your data stays on this device. Share a copy whenever you want to keep it elsewhere.'}</AppText><Button label={lang === 'tr' ? 'JSON yedeğini paylaş' : 'Share JSON backup'} onPress={() => share('json')} /><Button label={lang === 'tr' ? 'CSV dışa aktar' : 'Export CSV'} variant="secondary" onPress={() => share('csv')} /><Button label={lang === 'tr' ? 'Gizlilik Politikası' : 'Privacy Policy'} variant="secondary" onPress={() => void Linking.openURL(PRIVACY_URL)} /></View></Screen>;
}
const styles = StyleSheet.create({ body: { gap: spacing.md, marginTop: spacing.xl } });
