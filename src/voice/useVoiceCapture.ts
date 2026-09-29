/**
 * Thin wrapper around `expo-speech-recognition` — on-device speech-to-text,
 * no network, no API key, same spirit as the local parser. Talks to the OS
 * (like `src/notifications/index.ts`), so it is not unit-tested directly: it
 * needs a real microphone and a development build (not Expo Go — see
 * README "Runtime verification"), which this environment cannot run.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';

import type { UiLang } from '@/i18n';

const RECOGNITION_LANG: Record<UiLang, string> = { en: 'en-US', tr: 'tr-TR' };

export type VoiceStatus = 'idle' | 'listening' | 'unavailable' | 'permission-denied' | 'error';

export interface VoiceCapture {
  status: VoiceStatus;
  /** What's been heard so far in the current session. Empty once idle again. */
  transcript: string;
  start: () => Promise<void>;
  stop: () => void;
}

const PERMISSION_ERROR_CODES = new Set<ExpoSpeechRecognitionErrorEvent['error']>(['not-allowed', 'service-not-allowed']);
/** Not a real problem — the user tapped stop, or paused, before saying anything. */
const IGNORABLE_ERROR_CODES = new Set<ExpoSpeechRecognitionErrorEvent['error']>(['no-speech', 'aborted']);

/** Starts idle; call `start()` from a user gesture (mic permission prompts need one). */
export function useVoiceCapture(lang: UiLang): VoiceCapture {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const active = useRef(false);

  useSpeechRecognitionEvent('result', (event) => {
    if (!active.current) return;
    const text = event.results[0]?.transcript;
    if (text) setTranscript(text);
  });

  useSpeechRecognitionEvent('end', () => {
    active.current = false;
    setStatus((prev) => (prev === 'listening' ? 'idle' : prev));
  });

  useSpeechRecognitionEvent('error', (event) => {
    active.current = false;
    if (PERMISSION_ERROR_CODES.has(event.error)) setStatus('permission-denied');
    else if (!IGNORABLE_ERROR_CODES.has(event.error)) setStatus('error');
    else setStatus('idle');
  });

  // Stop listening if the screen using this hook unmounts mid-session.
  useEffect(
    () => () => {
      if (active.current) ExpoSpeechRecognitionModule.stop();
    },
    [],
  );

  const start = useCallback(async () => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setStatus('unavailable');
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setStatus('permission-denied');
      return;
    }
    setTranscript('');
    active.current = true;
    setStatus('listening');
    ExpoSpeechRecognitionModule.start({ lang: RECOGNITION_LANG[lang], interimResults: true, continuous: true });
  }, [lang]);

  const stop = useCallback(() => {
    if (active.current) ExpoSpeechRecognitionModule.stop();
  }, []);

  return { status, transcript, start, stop };
}
