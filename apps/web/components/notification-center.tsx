"use client";

import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  Gift,
  LockKeyhole,
  Settings,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { WorkspaceView } from "@/components/workspace-panel";

interface NotificationCenterProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onNavigate: (view: WorkspaceView) => void;
}

type Filter = "All" | "Plans" | "Draws" | "Security";

const initialNotifications = [
  {
    id: "autopilot",
    category: "Plans" as const,
    icon: CalendarClock,
    title: "Autopilot notification · preview",
    detail: "Example only — no live execution window or required action is inferred.",
    time: "Preview",
    unread: true,
    view: "autopilot" as const,
  },
  {
    id: "draw",
    category: "Draws" as const,
    icon: Gift,
    title: "VeilDraw notification · preview",
    detail: "Example only — no live draw, outcome, or reveal availability is claimed.",
    time: "Preview",
    unread: true,
    view: "draws" as const,
  },
  {
    id: "funding",
    category: "Plans" as const,
    icon: CheckCircle2,
    title: "Funding notification · preview",
    detail: "Example only — no wallet funding transaction or settlement event is claimed.",
    time: "Preview",
    unread: false,
    view: "activity" as const,
  },
] as const;

export function NotificationCenter({ open, onClose, onNavigate }: NotificationCenterProps) {
  const [filter, setFilter] = useState<Filter>("All");
  const [read, setRead] = useState<Set<string>>(new Set());
  const notifications = useMemo(
    () => initialNotifications.filter((item) => filter === "All" || item.category === filter),
    [filter],
  );

  if (!open) return null;

  return (
    <div
      className="side-panel-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-title"
    >
      <button
        className="side-panel-scrim"
        type="button"
        aria-label="Close notifications"
        onClick={onClose}
      />
      <aside className="side-panel notification-panel">
        <header className="side-panel-header">
          <div>
            <span className="eyebrow">INBOX</span>
            <h2 id="notification-title">Notifications</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close notifications"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="notification-privacy-note">
          <LockKeyhole size={16} />
          <p>
            <strong>Private by default.</strong> Notifications never include balances, contribution
            amounts, or private draw outcomes on the lock screen.
          </p>
        </div>
        <div className="notification-toolbar">
          {(["All", "Plans", "Draws", "Security"] as const).map((item) => (
            <button
              type="button"
              className={filter === item ? "active" : ""}
              key={item}
              onClick={() => {
                setFilter(item);
              }}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            className="settings-link"
            onClick={() => {
              onNavigate("settings");
              onClose();
            }}
          >
            <Settings size={14} /> Preferences
          </button>
        </div>
        <div className="notification-list">
          {notifications.length === 0 ? (
            <div className="notification-empty">
              <BellRing size={20} />
              <strong>No security alerts</strong>
              <span>Critical account notices will appear here.</span>
            </div>
          ) : (
            notifications.map((notification) => {
              const Icon = notification.icon;
              const unread = notification.unread && !read.has(notification.id);
              return (
                <button
                  className={unread ? "notification-item unread" : "notification-item"}
                  type="button"
                  key={notification.id}
                  onClick={() => {
                    setRead((current) => new Set(current).add(notification.id));
                    onNavigate(notification.view);
                    onClose();
                  }}
                >
                  <span className="notification-icon">
                    <Icon size={17} />
                  </span>
                  <span>
                    <strong>{notification.title}</strong>
                    <p>{notification.detail}</p>
                    <time>{notification.time}</time>
                  </span>
                  {unread ? <i className="unread-dot" /> : null}
                </button>
              );
            })
          )}
        </div>
        <footer className="side-panel-footer">
          <BellRing size={15} />
          <span>Critical account and security alerts cannot be disabled.</span>
        </footer>
      </aside>
    </div>
  );
}
