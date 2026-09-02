export const NATIVE_HANDLER_NAME = 'pastelBridge';

export const JS_TO_NATIVE_TYPES = [
  'gameReady',
  'requestHaptic',
  'performanceReport',
  'runtimeError',
] as const;

export const NATIVE_TO_JS_TYPES = ['pause', 'resume', 'setDeveloperConfiguration'] as const;

export type JsToNativeType = (typeof JS_TO_NATIVE_TYPES)[number];
export type NativeToJsType = (typeof NATIVE_TO_JS_TYPES)[number];

export type HapticStyle = 'light' | 'medium' | 'heavy';
export type HapticReason = 'selection' | 'move' | 'place' | 'invalid';

export type DeveloperConfigurationPayload = {
  renderer?: 'webgl' | 'webgpu';
  dprPreset?: 1 | 1.25 | 1.5 | 'native';
  benchmark?: string;
  haptics?: boolean;
  touchDebug?: boolean;
  localDevServer?: string;
};

export type JsToNativeMessage =
  | { type: 'gameReady'; payload: { renderer: string; viewport: { width: number; height: number } } }
  | { type: 'requestHaptic'; payload: { style: HapticStyle; reason?: HapticReason } }
  | { type: 'performanceReport'; payload: unknown }
  | { type: 'runtimeError'; payload: { message: string; stack?: string } };

export type NativeToJsMessage =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'setDeveloperConfiguration'; payload: DeveloperConfigurationPayload };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateJsToNative(value: unknown): JsToNativeMessage {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    throw new Error('Bridge payload must be an object with a type');
  }
  const type = value['type'];
  if (!JS_TO_NATIVE_TYPES.includes(type as JsToNativeType)) {
    throw new Error(`Unknown JS→native type: ${type}`);
  }
  if (!('payload' in value)) {
    throw new Error('Bridge payload is required');
  }
  const payload = value['payload'];
  switch (type) {
    case 'gameReady': {
      if (!isRecord(payload) || typeof payload['renderer'] !== 'string' || !isRecord(payload['viewport'])) {
        throw new Error('gameReady payload is malformed');
      }
      const viewport = payload['viewport'];
      if (typeof viewport['width'] !== 'number' || typeof viewport['height'] !== 'number') {
        throw new Error('gameReady viewport is malformed');
      }
      return {
        type: 'gameReady',
        payload: {
          renderer: payload['renderer'],
          viewport: { width: viewport['width'], height: viewport['height'] },
        },
      };
    }
    case 'requestHaptic': {
      if (!isRecord(payload) || !['light', 'medium', 'heavy'].includes(String(payload['style']))) {
        throw new Error('requestHaptic payload is malformed');
      }
      const reasonValue = payload['reason'];
      const message: { type: 'requestHaptic'; payload: { style: HapticStyle; reason?: HapticReason } } = {
        type: 'requestHaptic',
        payload: { style: payload['style'] as HapticStyle },
      };
      if (
        reasonValue === 'selection' ||
        reasonValue === 'move' ||
        reasonValue === 'place' ||
        reasonValue === 'invalid'
      ) {
        message.payload.reason = reasonValue;
      } else if (reasonValue !== undefined) {
        throw new Error('requestHaptic reason is malformed');
      }
      return message;
    }
    case 'performanceReport':
      if (!isRecord(payload)) {
        throw new Error('performanceReport payload is malformed');
      }
      return { type: 'performanceReport', payload };
    case 'runtimeError': {
      if (!isRecord(payload) || typeof payload['message'] !== 'string') {
        throw new Error('runtimeError payload is malformed');
      }
      const stack = payload['stack'];
      if (stack !== undefined && typeof stack !== 'string') {
        throw new Error('runtimeError stack must be a string');
      }
      const message: { type: 'runtimeError'; payload: { message: string; stack?: string } } = {
        type: 'runtimeError',
        payload: { message: payload['message'] },
      };
      if (typeof stack === 'string') {
        message.payload.stack = stack;
      }
      return message;
    }
    default:
      throw new Error(`Unknown JS→native type: ${type}`);
  }
}

export function validateNativeToJs(value: unknown): NativeToJsMessage {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    throw new Error('Native message must be an object with a type');
  }
  const type = value['type'];
  if (!NATIVE_TO_JS_TYPES.includes(type as NativeToJsType)) {
    throw new Error(`Unknown native→JS type: ${type}`);
  }
  if (type === 'pause' || type === 'resume') {
    return { type };
  }
  const payload = value['payload'];
  if (!isRecord(payload)) {
    throw new Error('setDeveloperConfiguration payload is malformed');
  }
  return { type: 'setDeveloperConfiguration', payload: payload as DeveloperConfigurationPayload };
}
