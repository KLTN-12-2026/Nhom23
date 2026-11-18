"use client";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ToastContent } from "@packages/components/toast-host";
import useSeller from "apps/seller-ui/src/hooks/useSeller";
import axios from "apps/seller-ui/src/utils/axioInstance";

interface Notification { id: string; title: string; message: string; isRead: boolean }
export default function SellerNotificationToasts() {
  const { seller } = useSeller();
  const seen = useRef<{ sellerId: string; ids: Set<string> } | null>(null);
  const { data } = useQuery<{ notifications: Notification[] }>({
    queryKey: ["seller-notifications", seller?.id],
    queryFn: async () => (await axios.get("/product/api/get-seller-notifications")).data,
    enabled: !!seller?.id,
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (!seller?.id || !data) return;
    // The first response is history, not newly arriving notifications.
    if (!seen.current || seen.current.sellerId !== seller.id) {
      seen.current = { sellerId: seller.id, ids: new Set(data.notifications.map(item => item.id)) };
      return;
    }
    for (const item of [...data.notifications].reverse()) {
      if (!seen.current.ids.has(item.id) && !item.isRead) {
        const detailAt = item.message.indexOf(": ");
        const body = detailAt > 0 ? item.message.slice(0, detailAt) : item.message;
        const detail = detailAt > 0 ? item.message.slice(detailAt + 2) : undefined;
        const moderationWarning = /violation|not approved|policy|suspend|flagged/i.test(item.title);
        toast(<ToastContent kind={moderationWarning ? "warning" : "notification"} title={item.title} body={body} detail={detail} />, {
          id: `seller-notification-${item.id}`, duration: 6000,
        });
      }
      seen.current.ids.add(item.id);
    }
  }, [data, seller?.id]);
  return null;
}
