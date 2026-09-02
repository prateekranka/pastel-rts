import {
  NATIVE_HANDLER_NAME,
  validateJsToNative,
  validateNativeToJs,
  type JsToNativeMessage,
  type NativeToJsMessage,
} from './messages';

type NativeHandler = {
  postMessage: (message: unknown) => void;
};

declare global {
  interface Window {
    webkit?: { messageHandlers?: Record<string, NativeHandler | undefined> };
    __pastelNative?: { postMessage: (message: unknown) => void };
  }
}

export class NativeBridge {
  private readonly listeners = new Set<(message: NativeToJsMessage) => void>();

  constructor() {
    window.__pastelNative = {
      postMessage: (message: unknown) => {
        try {
          const parsed = validateNativeToJs(message);
          for (const listener of this.listeners) {
            listener(parsed);
          }
        } catch (error) {
          console.warn('Ignored malformed native message', error);
        }
      },
    };
  }

  onNativeMessage(listener: (message: NativeToJsMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(message: JsToNativeMessage): void {
    const valid = validateJsToNative(message);
    const handler = window.webkit?.messageHandlers?.[NATIVE_HANDLER_NAME];
    handler?.postMessage(valid);
  }

  isHosted(): boolean {
    return Boolean(window.webkit?.messageHandlers?.[NATIVE_HANDLER_NAME]);
  }

  dispose(): void {
    this.listeners.clear();
    delete window.__pastelNative;
  }
}
