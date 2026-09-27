import { StyleSheet, View } from 'react-native';

import { useLanguage } from '@/store/language';
import { spacing } from '@/theme';

import { Chip } from './Chip';

/** EN / TR. Follows the device locale until the user picks one. */
export function LanguageSwitch() {
  const { lang, setLang } = useLanguage();
  return (
    <View style={styles.row}>
      <Chip testID="language-en" label="EN" selected={lang === 'en'} onPress={() => setLang('en')} />
      <Chip testID="language-tr" label="TR" selected={lang === 'tr'} onPress={() => setLang('tr')} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
});
