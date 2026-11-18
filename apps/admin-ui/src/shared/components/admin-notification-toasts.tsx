"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ToastContent } from "@packages/components/toast-host";
import { canAdmin } from "@packages/utils/admin-access";
import { useLanguage } from "@packages/components/language-switcher";
import useAdmin from "../../app/hooks/useAdmin";
import axios from "../../utils/axioInstance";

type AdminNotification = {
  id: string;
  title: string;
  message: string;
  metadata?: { event?: string; sellerName?: string; shopName?: string; reason?: string };
};

export default function AdminNotificationToasts() {
  const { admin } = useAdmin();
  const { language } = useLanguage();
  const client = useQueryClient();
  const seen = useRef<{ adminId: string; ids: Set<string> } | null>(null);
  const { data } = useQuery<{ notifications: AdminNotification[] }>({
    queryKey: ["admin-live-notifications", admin?.id],
    enabled: canAdmin(admin, "accounts") && canAdmin(admin, "notifications"),
    queryFn: async () => (await axios.get("/admin/notifications", { params: { page: 1, limit: 50 } })).data,
    staleTime: 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!admin?.id || !data) return;
    if (!seen.current || seen.current.adminId !== admin.id) {
      seen.current = { adminId: admin.id, ids: new Set(data.notifications.map(item => item.id)) };
      return;
    }
    for (const item of [...data.notifications].reverse()) {
      if (seen.current.ids.has(item.id)) continue;
      seen.current.ids.add(item.id);
      if (item.metadata?.event !== "seller_unsuspend_request") continue;

      const metadata = item.metadata;
      client.invalidateQueries({ queryKey: ["admin-ops", "notifications"] });
      toast(
        <ToastContent
          kind="warning"
          title={language === "vi" ? "Yêu cầu mở khóa tài khoản seller" : item.title}
          body={[metadata.shopName, metadata.sellerName].filter(Boolean).join(" · ") || item.message}
          detail={metadata.reason && metadata.reason.length > 240 ? `${metadata.reason.slice(0, 237)}…` : metadata.reason}
        />,
        { id: `admin-notification-${item.id}`, duration: 10_000 },
      );
    }
  }, [admin?.id, client, data, language]);

  return null;
}
