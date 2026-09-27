import { randomUUID } from 'expo-crypto';

/** App-side id generator. The engine receives it via EngineContext so tests can inject a counter. */
export function newId(): string {
  return randomUUID();
}
