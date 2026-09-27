import { Pressable, StyleSheet, View } from 'react-native';

import { snoozeOptions } from '@/engine/suggestions';
import { strings, type UiLang } from '@/i18n';
import { colors, hairline, radius, spacing } from '@/theme';
import { formatDateLabel } from '@/utils/format';
import { nudgeWhen, seedWhen, type WhenUnit } from '@/utils/whenEdit';

import { AppText } from './AppText';
import { Chip } from './Chip';

interface WhenPickerProps {
  /** The current review time, or null when there is none yet. */
  value: Date | null;
  now: Date;
  lang?: UiLang;
  onChange: (next: Date) => void;
  /** Prefix for testIDs: `${testID}-day-next`, `${testID}-hour-prev`, … */
  testID: string;
  labels?: { date: string; time: string };
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Date and time without a native picker: quick choices, then a stepper per unit.
 * Identical on iOS, Android and the web build, and every control is a plain button
 * with an accessibility label.
 */
export function WhenPicker({ value, now, lang = 'en', onChange, testID, labels }: WhenPickerProps) {
  const s = strings(lang);
  const fieldLabels = labels ?? { date: s.field.date, time: s.field.time };
  const step = (unit: WhenUnit, direction: 1 | -1) => onChange(nudgeWhen(value ?? seedWhen(now), unit, direction));

  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {snoozeOptions(now, lang)
          .filter((o) => o.key !== 'in_15_min')
          .map((o) => (
            <Chip
              key={o.key}
              testID={`${testID}-preset-${o.key}`}
              label={o.label.replace(/ · \d\d:\d\d$/, '')}
              selected={value !== null && value.getTime() === o.at.getTime()}
              onPress={() => onChange(o.at)}
            />
          ))}
      </View>

      {value === null ? (
        <Chip testID={`${testID}-set`} label={s.sheets.whenPicker.setATime} onPress={() => onChange(seedWhen(now))} />
      ) : (
        <View style={styles.rows}>
          <Row label={fieldLabels.date}>
            <Stepper testID={`${testID}-day`} text={formatDateLabel(value, now, lang)} wide onStep={(d) => step('day', d)} what={s.sheets.whenPicker.unit.day} s={s} />
          </Row>
          <Row label={fieldLabels.time}>
            <Stepper testID={`${testID}-hour`} text={two(value.getHours())} onStep={(d) => step('hour', d)} what={s.sheets.whenPicker.unit.hour} s={s} />
            <AppText tone="muted">:</AppText>
            <Stepper testID={`${testID}-minute`} text={two(value.getMinutes())} onStep={(d) => step('minute', d)} what={s.sheets.whenPicker.unit.minute} s={s} />
          </Row>
        </View>
      )}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <AppText variant="caption" tone="muted" style={styles.rowLabel}>
        {label}
      </AppText>
      <View style={styles.rowControls}>{children}</View>
    </View>
  );
}

interface StepperProps {
  text: string;
  what: string;
  testID: string;
  wide?: boolean;
  onStep: (direction: 1 | -1) => void;
  s: ReturnType<typeof strings>;
}

function Stepper({ text, what, testID, wide = false, onStep, s }: StepperProps) {
  return (
    <View style={styles.stepper}>
      <Pressable
        testID={`${testID}-prev`}
        accessibilityRole="button"
        accessibilityLabel={s.sheets.whenPicker.earlier(what)}
        hitSlop={6}
        onPress={() => onStep(-1)}
        style={styles.arrow}
      >
        <AppText variant="bodyStrong">‹</AppText>
      </Pressable>
      <AppText testID={`${testID}-value`} variant="bodyStrong" style={[styles.value, wide && styles.valueWide]}>
        {text}
      </AppText>
      <Pressable
        testID={`${testID}-next`}
        accessibilityRole="button"
        accessibilityLabel={s.sheets.whenPicker.later(what)}
        hitSlop={6}
        onPress={() => onStep(1)}
        style={styles.arrow}
      >
        <AppText variant="bodyStrong">›</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rows: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowLabel: { width: 44 },
  rowControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  arrow: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  value: { minWidth: 30, textAlign: 'center' },
  valueWide: { minWidth: 104 },
});
