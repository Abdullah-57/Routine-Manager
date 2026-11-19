import { NativeEventEmitter, NativeModules, Platform } from "react-native";

export type WakeWordTriggerEvent = {
  wakePhrase: string;
  transcript: string;
  timestamp: number;
};

export type BackgroundAssistantStatus = {
  isRunning: boolean;
  isListening: boolean;
  activeWakePhrase: string;
};

const LINKING_ERROR =
  `The package 'AssistantBackgroundModule' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have rebuilt your project\n", default: "" }) +
  "- You rebuilt the Android app with 'npx expo run:android'\n";

const NativeModule = NativeModules.AssistantBackgroundModule
  ? NativeModules.AssistantBackgroundModule
  : new Proxy(
      {},
      {
        get() {
          return () => {
            if (Platform.OS === "android") {
              // Graceful fallback during dev without native rebuild
              return Promise.resolve(false);
            }
            return Promise.resolve(false);
          };
        },
      },
    );

const eventEmitter =
  Platform.OS === "android" && NativeModules.AssistantBackgroundModule
    ? new NativeEventEmitter(NativeModules.AssistantBackgroundModule)
    : null;

/**
 * Checks if the native Android background assistant module is loaded and ready.
 */
export function isNativeBackgroundSupported(): boolean {
  return Platform.OS === "android" && !!NativeModules.AssistantBackgroundModule;
}

/**
 * Starts the Android foreground service for continuous hands-free "Hey Assistant" wake-word listening.
 * @param wakePhrase Optional custom wake phrase (defaults to "hey assistant").
 */
export async function startBackgroundListener(
  wakePhrase?: string,
): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (!NativeModules.AssistantBackgroundModule) {
    console.warn(LINKING_ERROR);
    return false;
  }
  try {
    return await NativeModule.startBackgroundListener(wakePhrase ?? "hey assistant");
  } catch (error) {
    console.warn("[BackgroundAssistant] Failed to start background listener:", error);
    return false;
  }
}

/**
 * Stops the Android foreground service and releases microphone resources.
 */
export async function stopBackgroundListener(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (!NativeModules.AssistantBackgroundModule) return false;
  try {
    return await NativeModule.stopBackgroundListener();
  } catch (error) {
    console.warn("[BackgroundAssistant] Failed to stop background listener:", error);
    return false;
  }
}

/**
 * Queries the active status of the native background service.
 */
export async function getBackgroundAssistantStatus(): Promise<BackgroundAssistantStatus> {
  if (Platform.OS !== "android" || !NativeModules.AssistantBackgroundModule) {
    return {
      isRunning: false,
      isListening: false,
      activeWakePhrase: "hey assistant",
    };
  }
  try {
    return await NativeModule.isListening();
  } catch {
    return {
      isRunning: false,
      isListening: false,
      activeWakePhrase: "hey assistant",
    };
  }
}

/**
 * Dynamically updates the active wake phrase for the running foreground service.
 */
export async function updateBackgroundWakePhrase(
  wakePhrase: string,
): Promise<boolean> {
  if (Platform.OS !== "android" || !NativeModules.AssistantBackgroundModule) {
    return false;
  }
  try {
    return await NativeModule.setWakePhrase(wakePhrase);
  } catch {
    return false;
  }
}

/**
 * Subscribes to wake-word trigger events emitted from the native Android background service.
 * Returns an unsubscribe callback.
 */
export function addBackgroundWakeWordListener(
  listener: (event: WakeWordTriggerEvent) => void,
): () => void {
  if (!eventEmitter) {
    return () => {};
  }
  const subscription = eventEmitter.addListener(
    "onWakeWordTriggered",
    (event: any) => {
      listener(event as WakeWordTriggerEvent);
    },
  );
  return () => {
    subscription.remove();
  };
}
