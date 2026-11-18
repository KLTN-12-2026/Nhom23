"use client";

import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info, LoaderCircle, X } from "lucide-react";
import toast, { ToastBar, Toaster } from "react-hot-toast";
import type { Renderable, ToastOptions } from "react-hot-toast";
import { isValidElement } from "react";

type ToastContentProps = { kind: "notification" | "warning"; title: string; body: string; detail?: string };

export function ToastContent({ title, body, detail }: ToastContentProps) {
  return (
    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <strong style={{ color: "#f1f5f9", fontSize: 14, fontWeight: 650, lineHeight: "20px", overflowWrap: "anywhere" }}>{title}</strong>
      <span style={{ color: "#cbd5e1", fontSize: 13, fontWeight: 500, lineHeight: "18px", overflowWrap: "anywhere" }}>{body}</span>
      {detail && <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 400, lineHeight: "17px", overflowWrap: "anywhere" }}>{detail}</span>}
    </div>
  );
}

export function toastWarning(message: Renderable, options?: ToastOptions) {
  return toast(message, {
    ...options,
    icon: <AlertTriangle data-toast-tone="warning" size={18} strokeWidth={2.2} />,
    duration: options?.duration ?? 5500,
  });
}

export default function ToastHost() {
  return (
    <Toaster
      position="top-right"
      reverseOrder={false}
      gutter={10}
      toastOptions={{ duration: 4500, success: { duration: 4000 }, error: { duration: 6500 }, loading: { duration: Infinity } }}
      containerStyle={{ top: 16, right: 16 }}
    >
      {item => {
        const warningIcon = isValidElement<{ "data-toast-tone"?: string }>(item.icon) && item.icon.props["data-toast-tone"] === "warning";
        const warningMessage = isValidElement<ToastContentProps>(item.message) && item.message.props.kind === "warning";
        const warning = warningIcon || warningMessage;
        const tone = item.type === "success"
          ? { color: "#34d399", border: "rgba(52, 211, 153, .24)", background: "rgba(8, 24, 23, .96)", label: "Success", Icon: CheckCircle2 }
          : item.type === "error"
            ? { color: "#fb7185", border: "rgba(251, 113, 133, .25)", background: "rgba(30, 13, 20, .97)", label: "Could not complete", Icon: AlertCircle }
            : item.type === "loading"
              ? { color: "#38bdf8", border: "rgba(56, 189, 248, .24)", background: "rgba(10, 22, 34, .97)", label: "Working", Icon: LoaderCircle }
              : warning
                ? { color: "#fbbf24", border: "rgba(251, 191, 36, .26)", background: "rgba(31, 24, 11, .97)", label: "Check this", Icon: AlertTriangle }
              : { color: "#60a5fa", border: "rgba(96, 165, 250, .24)", background: "rgba(12, 20, 35, .97)", label: "Notification", Icon: item.type === "blank" ? Bell : Info };
        const Icon = tone.Icon;

        return (
          <ToastBar
            toast={item}
            style={{ width: "min(440px, calc(100vw - 32px))", padding: 0, background: "transparent", boxShadow: "none" }}
          >
            {({ message }) => {
              const structured = isValidElement<ToastContentProps>(message) && ["notification", "warning"].includes(message.props.kind);
              const content = structured ? message.props : null;

              return (
              <div
                style={{
                  position: "relative", display: "flex", alignItems: "flex-start", gap: 12,
                  overflow: "hidden", width: "100%", padding: "14px 12px 14px 16px",
                  border: `1px solid ${tone.border}`, borderRadius: 16, color: "#e2e8f0",
                  background: tone.background, boxShadow: "0 18px 45px rgba(0, 0, 0, .32)",
                  backdropFilter: "blur(16px)",
                }}
              >
                <span aria-hidden="true" style={{ position: "absolute", inset: "10px auto 10px 0", width: 3, borderRadius: 99, background: tone.color, opacity: .85 }} />
                <span aria-hidden="true" style={{ display: "grid", placeItems: "center", flex: "0 0 34px", width: 34, height: 34, borderRadius: 11, color: tone.color, background: `${tone.color}18` }}>
                  <Icon size={18} strokeWidth={2.2} className={item.type === "loading" ? "animate-spin" : undefined} />
                </span>
                <div style={{ minWidth: 0, flex: 1, paddingTop: 1 }}>
                  {content ? <>
                    <p style={{ margin: 0, color: "#f1f5f9", fontSize: 14, fontWeight: 650, letterSpacing: "-.01em", lineHeight: "20px", overflowWrap: "anywhere" }}>{content.title}</p>
                    <p style={{ margin: "4px 0 0", color: "#cbd5e1", fontSize: 13, fontWeight: 500, lineHeight: "18px", overflowWrap: "anywhere" }}>{content.body}</p>
                    {content.detail && <p style={{ margin: "3px 0 0", color: "#94a3b8", fontSize: 12, fontWeight: 400, lineHeight: "17px", overflowWrap: "anywhere" }}>{content.detail}</p>}
                  </> : <>
                    <p style={{ margin: 0, color: tone.color, fontSize: 10, fontWeight: 700, letterSpacing: ".07em", lineHeight: "14px" }}>{tone.label}</p>
                    <div style={{ marginTop: 3, color: "#e2e8f0", fontSize: 13, fontWeight: 500, lineHeight: "19px", overflowWrap: "anywhere" }}>{message}</div>
                  </>}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => toast.dismiss(item.id)}
                  style={{ display: "grid", placeItems: "center", flex: "0 0 28px", width: 28, height: 28, margin: -4, border: 0, borderRadius: 8, color: "#94a3b8", background: "transparent", cursor: "pointer" }}
                >
                  <X size={16} />
                </button>
              </div>
              );
            }}
          </ToastBar>
        );
      }}
    </Toaster>
  );
}
