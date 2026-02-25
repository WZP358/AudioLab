import React, { useState, useEffect } from "react";
import {
  Bell,
  CheckCircle,
  AlertCircle,
  Info,
  X,
  Mail,
  MailOpen,
} from "lucide-react";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export default function NotificationCenter({ token, onClose }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState("all"); // all, unread, read

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter === "unread") {
        params.append("is_read", "false");
      } else if (filter === "read") {
        params.append("is_read", "true");
      }

      const resp = await fetch(
        `${API_BASE}/api/system/notifications?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!resp.ok) throw new Error("获取通知失败");
      const data = await resp.json();
      setNotifications(data.items || []);
    } catch (err) {
      console.error("获取通知失败:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/system/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setUnreadCount(data.count || 0);
      }
    } catch (err) {
      console.error("获取未读数量失败:", err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    fetchUnreadCount();
    // 每30秒刷新一次未读数量
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const markAsRead = async (id) => {
    try {
      const resp = await fetch(
        `${API_BASE}/api/system/notifications/${id}/read`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!resp.ok) throw new Error("标记失败");
      const data = await resp.json().catch(() => ({}));

      // 本地更新这条通知的已读状态，避免依赖多次刷新
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, is_read: true, read_at: data.notification?.read_at || n.read_at } : n
        )
      );

      // 使用后端返回的未读数量（如果有），否则从本地重新统计
      if (typeof data.unread_count === "number") {
        setUnreadCount(data.unread_count);
      } else {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }

      // 为保证与后端完全同步，再轻量刷新一次未读数（不必立即刷新列表）
      fetchUnreadCount();
    } catch (err) {
      console.error("标记失败:", err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unreadNotifications = notifications.filter((n) => !n.is_read);
      await Promise.all(
        unreadNotifications.map((n) =>
          fetch(`${API_BASE}/api/system/notifications/${n.id}/read`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}` },
          })
        )
      );
      fetchNotifications();
      fetchUnreadCount();
    } catch (err) {
      console.error("批量标记失败:", err);
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case "success":
        return <CheckCircle className="text-emerald-400" size={20} />;
      case "error":
        return <AlertCircle className="text-red-400" size={20} />;
      case "warning":
        return <AlertCircle className="text-yellow-400" size={20} />;
      default:
        return <Info className="text-blue-400" size={20} />;
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case "success":
        return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
      case "error":
        return "bg-red-500/20 text-red-300 border-red-500/30";
      case "warning":
        return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
      default:
        return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "unread") return !n.is_read;
    if (filter === "read") return n.is_read;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 rounded-xl border border-slate-700 w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <Bell className="text-cyan-400" size={24} />
            <h2 className="text-xl font-bold text-white">通知中心</h2>
            {unreadCount > 0 && (
              <span className="px-2 py-1 bg-red-500 text-white text-xs rounded-full">
                {unreadCount} 条未读
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition"
              >
                全部标记为已读
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-800 rounded-lg transition"
            >
              <X className="text-slate-400" size={20} />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 p-4 border-b border-slate-700">
          {[
            { id: "all", label: "全部" },
            { id: "unread", label: "未读" },
            { id: "read", label: "已读" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              className={`px-4 py-2 rounded-lg text-sm transition ${
                filter === item.id
                  ? "bg-cyan-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="text-center text-slate-400 py-8">加载中...</div>
          ) : filteredNotifications.length === 0 ? (
            <div className="text-center text-slate-400 py-12">
              <MailOpen className="mx-auto mb-3 text-slate-600" size={48} />
              <p>暂无通知</p>
            </div>
          ) : (
            filteredNotifications.map((notif) => (
              <div
                key={notif.id}
                className={`bg-slate-800 rounded-lg p-4 border transition ${
                  !notif.is_read
                    ? "border-cyan-500/50 bg-slate-800/80"
                    : "border-slate-700"
                } ${getTypeColor(notif.type)}`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{getTypeIcon(notif.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-medium text-white">{notif.title}</h3>
                      {!notif.is_read && (
                        <button
                          onClick={() => markAsRead(notif.id)}
                          className="flex-shrink-0 p-1 hover:bg-slate-700 rounded transition"
                          title="标记为已读"
                        >
                          <Mail className="text-slate-400" size={16} />
                        </button>
                      )}
                      {notif.is_read && (
                        <MailOpen className="text-slate-600" size={16} />
                      )}
                    </div>
                    <p className="text-slate-300 text-sm mb-2 whitespace-pre-wrap">
                      {notif.content}
                    </p>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        {notif.created_at
                          ? new Date(notif.created_at).toLocaleString("zh-CN")
                          : ""}
                      </p>
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          notif.type === "info"
                            ? "bg-blue-500/20 text-blue-300"
                            : notif.type === "warning"
                            ? "bg-yellow-500/20 text-yellow-300"
                            : notif.type === "error"
                            ? "bg-red-500/20 text-red-300"
                            : "bg-emerald-500/20 text-emerald-300"
                        }`}
                      >
                        {notif.type === "info"
                          ? "信息"
                          : notif.type === "warning"
                          ? "警告"
                          : notif.type === "error"
                          ? "错误"
                          : "成功"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
