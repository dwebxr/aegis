"use client";
import React, { createContext, useContext } from "react";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { NotificationToast } from "@/components/ui/NotificationToast";
import { useWindowSize } from "@/hooks/useWindowSize";

interface NotificationContextValue {
  addNotification: (text: string, type: Notification["type"]) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  addNotification: () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { notifications, addNotification } = useNotifications();
  const { mobile } = useWindowSize();

  return (
    <NotificationContext.Provider value={{ addNotification }}>
      {children}
      <NotificationToast notifications={notifications} mobile={mobile} />
    </NotificationContext.Provider>
  );
}

export function useNotify() {
  return useContext(NotificationContext);
}
