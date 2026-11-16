import { NativeModule, requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

export type IncomingIntent = {
  action: string | null;
  data: string | null;
  type: string | null;
  extras: Record<string, string | string[] | null>;
};

type Events = {
  onIntent: (intent: IncomingIntent) => void;
};

declare class IntentExtrasModule extends NativeModule<Events> {
  getInitialIntent(): IncomingIntent | null;
}

// Android only. On iOS this is null and the app falls back to Linking.
const native = requireOptionalNativeModule<IntentExtrasModule>('IntentExtras');

export function getInitialIntent(): IncomingIntent | null {
  return native?.getInitialIntent() ?? null;
}

export function addIntentListener(cb: (intent: IncomingIntent) => void): EventSubscription | null {
  return native?.addListener('onIntent', cb) ?? null;
}
