import React, { useState, useEffect } from "react";
import { MessageCircle, Send, X, MailOpen } from "lucide-react";
import { useToast } from "./Toast";
import { useTheme } from "./ThemeContext";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export default function ExpertMessageDialog({ token, onClose }) {
  const { showError, showSuccess } = useToast();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);

  const loadMessages = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/messages/expert`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        throw new Error("加载历史建议失败");
      }
      const data = await resp.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      showError(err.message || "加载历史建议失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!subject.trim()) {
      showError("请填写主题。");
      return;
    }
    if (!content.trim()) {
      showError("请填写内容。");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch(`${API_BASE}/api/messages/expert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subject: subject.trim(),
          content: content.trim(),
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        let detail = txt;
        try {
          const json = JSON.parse(txt || "{}");
          detail = json.detail || json.message || txt;
        } catch {
          // ignore
        }
        throw new Error(detail || "发送失败");
      }
      showSuccess("已提交，管理员将统一处理。");
      setSubject("");
      setContent("");
      loadMessages();
    } catch (err) {
      console.error(err);
      showError(err.message || "发送失败");
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status) => {
    if (status === "answered") {
      return (
        <span className={`px-2 py-0.5 rounded-full text-xs border ${
          isDark
            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
            : "bg-emerald-50 text-emerald-700 border-emerald-300"
        }`}>
          已回复
        </span>
      );
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs border ${
        isDark
          ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
          : "bg-amber-50 text-amber-700 border-amber-300"
      }`}>
        待处理
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`rounded-2xl border w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? "border-slate-700" : "border-slate-200"}`}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
              <MessageCircle size={20} className="text-cyan-400" />
            </div>
            <div>
              {/*<h2 className="text-lg font-bold text-white">给管理员的建议</h2>*/}
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                可提交使用反馈、需求或问题说明，管理员将在后台查看并回复。
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition ${isDark ? "hover:bg-slate-800 text-slate-400 hover:text-white" : "hover:bg-slate-100 text-slate-600 hover:text-slate-800"}`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className={`rounded-xl border p-4 space-y-3 ${isDark ? "bg-slate-800/80 border-slate-700" : "bg-slate-50 border-slate-200"}`}
          >
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                主题
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={255}
                placeholder="例如：新增算法支持 / 交互体验优化"
                className={`w-full px-3 py-2 rounded-lg border text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 ${isDark ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-slate-300 text-slate-800"}`}
              />
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                内容
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder="建议包含：背景、复现步骤（如有）、期望结果。"
                className={`w-full px-3 py-2 rounded-lg border text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 resize-none ${isDark ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-slate-300 text-slate-800"}`}
              />
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-600"}`}>
                提交后不会公开展示，仅管理员可见。
              </p>
              <button
                type="submit"
                disabled={submitting || !subject.trim() || !content.trim()}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium text-white transition ${
                  isDark ? "disabled:bg-slate-700 disabled:text-slate-500" : "disabled:bg-slate-200 disabled:text-slate-400"
                }`}
              >
                <Send size={16} />
                {submitting ? "发送中..." : "发送给管理员"}
              </button>
            </div>
          </form>

          {/* History */}
          <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/60 border-slate-700" : "bg-slate-50 border-slate-200"}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MailOpen size={16} className={isDark ? "text-slate-300" : "text-slate-600"} />
                <h3 className={`text-sm font-semibold ${isDark ? "text-slate-100" : "text-slate-800"}`}>
                  我的历史建议
                </h3>
              </div>
              {loading && (
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-slate-600"}`}>加载中...</span>
              )}
            </div>
            {messages.length === 0 && !loading ? (
              <div className={`text-center text-sm py-6 ${isDark ? "text-slate-500" : "text-slate-600"}`}>
                暂无记录。
              </div>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg border p-3 space-y-1.5 ${isDark ? "bg-slate-900/60 border-slate-700" : "bg-white border-slate-200"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${isDark ? "text-slate-100" : "text-slate-800"}`}>
                          {m.subject}
                        </span>
                        {statusBadge(m.status)}
                      </div>
                      <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-600"}`}>
                        {m.created_at
                          ? new Date(m.created_at).toLocaleString("zh-CN")
                          : ""}
                      </span>
                    </div>
                    <p className={`text-xs whitespace-pre-wrap ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                      {m.content}
                    </p>
                    {m.reply_content && (
                      <div className={`mt-2 rounded-lg px-3 py-2 border ${
                        isDark
                          ? "bg-slate-800/80 border-emerald-600/40"
                          : "bg-emerald-50 border-emerald-200"
                      }`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[11px] font-semibold ${isDark ? "text-emerald-300" : "text-emerald-700"}`}>
                            管理员回复
                          </span>
                          {m.replied_at && (
                            <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-slate-600"}`}>
                              {new Date(m.replied_at).toLocaleString("zh-CN")}
                            </span>
                          )}
                        </div>
                        <p className={`text-xs whitespace-pre-wrap ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                          {m.reply_content}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

