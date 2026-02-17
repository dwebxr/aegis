"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { errMsg } from "@/lib/utils/errors";

const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();
const LS_KEY = "aegis-push-enabled";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotification() {
  const { isAuthenticated, identity } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const actorRef = useRef<Awaited<ReturnType<typeof createBackendActorAsync>> | null>(null);

  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      !!VAPID_PUBLIC_KEY;

    setIsSupported(supported);

    if (supported) {
      setPermission(Notification.permission);
      navigator.serviceWorker.ready.then(reg => {
        reg.pushManager.getSubscription().then(setSubscription).catch(err => {
          console.warn("[push] Failed to get existing subscription:", errMsg(err));
        });
      }).catch(err => {
        console.warn("[push] Service worker not ready:", errMsg(err));
      });
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !identity) {
      actorRef.current = null;
      return;
    }
    createBackendActorAsync(identity).then(actor => {
      actorRef.current = actor;
    }).catch(err => {
      console.error("[push] Actor creation failed:", errMsg(err));
    });
  }, [isAuthenticated, identity]);

  const subscribe = useCallback(async () => {
    if (!isAuthenticated || !identity || !isSupported) return null;

    setIsLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return null;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });

      const subJson = sub.toJSON();
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
        throw new Error("Invalid subscription format");
      }

      // Register on canister
      if (!actorRef.current) {
        actorRef.current = await createBackendActorAsync(identity);
      }
      await actorRef.current.registerPushSubscription(
        subJson.endpoint,
        subJson.keys.p256dh,
        subJson.keys.auth,
      );

      localStorage.setItem(LS_KEY, "1");
      setSubscription(sub);
      return sub;
    } catch (error) {
      console.error("[push] Subscribe error:", errMsg(error));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, identity, isSupported]);

  const unsubscribe = useCallback(async () => {
    if (!subscription) return;

    setIsLoading(true);
    try {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      if (!actorRef.current && identity) {
        actorRef.current = await createBackendActorAsync(identity);
      }
      if (actorRef.current) {
        await actorRef.current.unregisterPushSubscription(endpoint);
      }

      localStorage.removeItem(LS_KEY);
      setSubscription(null);
    } catch (error) {
      console.error("[push] Unsubscribe error:", errMsg(error));
    } finally {
      setIsLoading(false);
    }
  }, [subscription, identity]);

  return {
    isSupported,
    permission,
    subscription,
    subscribe,
    unsubscribe,
    isSubscribed: !!subscription,
    isLoading,
  };
}
