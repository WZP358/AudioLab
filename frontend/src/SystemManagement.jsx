import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import html2canvas from "html2canvas";
import {
  FileText,
  Settings,
  Bell,
  Download,
  BarChart3,
  Activity,
  Info,
  Save,
  Plus,
  Users,
  Mail,
  Send,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useToast } from "./Toast";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export default function SystemManagement({ token }) {
  const location = useLocation();
  const pathname = (location?.pathname || "").replace(/\/+$/, "") || "/";

  // 根据 URL 判断当前是哪个独立子页面
  let currentSection = "all";
  if (pathname === "/admin/system" || pathname === "/admin/system/logs") {
    currentSection = "logs";
  } else if (pathname === "/admin/system/settings") {
    currentSection = "settings";
  } else if (pathname === "/admin/system/notifications") {
    currentSection = "notifications";
  } else if (pathname === "/admin/system/analytics") {
    currentSection = "analytics";
  } else if (pathname === "/admin/system/tasks") {
    currentSection = "tasks";
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-900">
      {/* Page Header */}
      {/*<div className="border-b border-slate-700 bg-slate-800 px-6 py-4">*/}
      {/*  /!*<div className="flex flex-col gap-3">*!/*/}
      {/*  /!*  /!*<div className="flex items-center gap-3">*!/*!/*/}
      {/*  /!*  /!*  <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">*!/*!/*/}
      {/*  /!*  /!*    <Settings size={18} className="text-cyan-400" />*!/*!/*/}
      {/*  /!*  /!*  </div>*!/*!/*/}
      {/*  /!*  /!*  /!*<div>*!/*!/*!/*/}
      {/*  /!*  /!*  /!*  <div className="text-white font-semibold text-lg">系统管理</div>*!/*!/*!/*/}
      {/*  /!*  /!*  /!*  <div className="text-xs text-slate-400">*!/*!/*!/*/}
      {/*  /!*  /!*  /!*    系统日志 / 系统设置 / 通知中心 / 数据统计 / 分离任务历史*!/*!/*!/*/}
      {/*  /!*  /!*  /!*  </div>*!/*!/*!/*/}
      {/*  /!*  /!*  /!*</div>*!/*!/*!/*/}
      {/*  /!*  /!*</div>*!/*!/*/}
      {/*  /!*  /!*<div className="flex flex-wrap gap-2">*!/*!/*/}
      {/*  /!*  /!*  <button*!/*!/*/}
      {/*  /!*  /!*    onClick={() => navigate("/admin/system/logs")}*!/*!/*/}
      {/*  /!*  /!*    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${*!/*!/*/}
      {/*  /!*  /!*      currentSection === "logs"*!/*!/*/}
      {/*  /!*  /!*        ? "bg-cyan-600 text-white shadow shadow-cyan-900/30"*!/*!/*/}
      {/*  /!*  /!*        : "bg-slate-900 text-slate-300 hover:bg-slate-700"*!/*!/*/}
      {/*  /!*  /!*    }`}*!/*!/*/}
      {/*  /!*  /!*  >*!/*!/*/}
      {/*  /!*  /!*    系统日志*!/*!/*/}
      {/*  /!*  /!*  </button>*!/*!/*/}
      {/*  /!*  /!*  <button*!/*!/*/}
      {/*  /!*  /!*    onClick={() => navigate("/admin/system/settings")}*!/*!/*/}
      {/*  /!*  /!*    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${*!/*!/*/}
      {/*  /!*  /!*      currentSection === "settings"*!/*!/*/}
      {/*  /!*  /!*        ? "bg-cyan-600 text-white shadow shadow-cyan-900/30"*!/*!/*/}
      {/*  /!*  /!*        : "bg-slate-900 text-slate-300 hover:bg-slate-700"*!/*!/*/}
      {/*  /!*  /!*    }`}*!/*!/*/}
      {/*  /!*  /!*  >*!/*!/*/}
      {/*  /!*  /!*    系统设置*!/*!/*/}
      {/*  /!*  /!*  </button>*!/*!/*/}
      {/*  /!*  /!*  <button*!/*!/*/}
      {/*  /!*  /!*    onClick={() => navigate("/admin/system/notifications")}*!/*!/*/}
      {/*  /!*  /!*    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${*!/*!/*/}
      {/*  /!*  /!*      currentSection === "notifications"*!/*!/*/}
      {/*  /!*  /!*        ? "bg-cyan-600 text-white shadow shadow-cyan-900/30"*!/*!/*/}
      {/*  /!*  /!*        : "bg-slate-900 text-slate-300 hover:bg-slate-700"*!/*!/*/}
      {/*  /!*  /!*    }`}*!/*!/*/}
      {/*  /!*  /!*  >*!/*!/*/}
      {/*  /!*  /!*    通知中心*!/*!/*/}
      {/*  /!*  /!*  </button>*!/*!/*/}
      {/*  /!*  /!*  <button*!/*!/*/}
      {/*  /!*  /!*    onClick={() => navigate("/admin/system/analytics")}*!/*!/*/}
      {/*  /!*  /!*    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${*!/*!/*/}
      {/*  /!*  /!*      currentSection === "analytics"*!/*!/*/}
      {/*  /!*  /!*        ? "bg-cyan-600 text-white shadow shadow-cyan-900/30"*!/*!/*/}
      {/*  /!*  /!*        : "bg-slate-900 text-slate-300 hover:bg-slate-700"*!/*!/*/}
      {/*  /!*  /!*    }`}*!/*!/*/}
      {/*  /!*  /!*  >*!/*!/*/}
      {/*  /!*  /!*    数据统计*!/*!/*/}
      {/*  /!*  /!*  </button>*!/*!/*/}
      {/*  /!*  /!*  <button*!/*!/*/}
      {/*  /!*  /!*    onClick={() => navigate("/admin/system/tasks")}*!/*!/*/}
      {/*  /!*  /!*    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${*!/*!/*/}
      {/*  /!*  /!*      currentSection === "tasks"*!/*!/*/}
      {/*  /!*  /!*        ? "bg-cyan-600 text-white shadow shadow-cyan-900/30"*!/*!/*/}
      {/*  /!*  /!*        : "bg-slate-900 text-slate-300 hover:bg-slate-700"*!/*!/*/}
      {/*  /!*  /!*    }`}*!/*!/*/}
      {/*  /!*  /!*  >*!/*!/*/}
      {/*  /!*  /!*    分离任务历史*!/*!/*/}
      {/*  /!*  /!*  </button>*!/*!/*/}
      {/*  /!*  /!*</div>*!/*!/*/}
      {/*  /!*</div>*!/*/}
      {/*</div>*/}

      {/* Content：当访问特定 URL 时只展示对应模块；访问 /admin/system 时仍可按需扩展为展示全部 */}
      <div className="flex-1 overflow-auto p-6 space-y-8">
        {(currentSection === "logs" || currentSection === "all") && (
          <div id="system-logs">
            <SystemLogs token={token} />
          </div>
        )}
        {(currentSection === "settings" || currentSection === "all") && (
          <div id="system-settings">
            <SystemSettings token={token} />
          </div>
        )}
        {(currentSection === "notifications" || currentSection === "all") && (
          <div id="system-notifications">
            <Notifications token={token} />
          </div>
        )}
        {(currentSection === "analytics" || currentSection === "all") && (
          <div id="system-analytics">
            <Analytics token={token} />
          </div>
        )}
        {currentSection === "tasks" && (
          <div id="system-tasks">
            <TaskHistoryAdmin token={token} />
          </div>
        )}
      </div>
    </div>
  );
}

// 分离任务历史（管理员独立页面）
function TaskHistoryAdmin({ token }) {
  const { showError } = useToast();
  const [taskHistory, setTaskHistory] = useState([]);
  const [taskHistoryPage, setTaskHistoryPage] = useState(1);
  const [taskHistoryTotalPages, setTaskHistoryTotalPages] = useState(1);
  const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);

  const fetchTaskHistory = async (page = 1) => {
    setTaskHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", "20");
      const resp = await fetch(
        `${API_BASE}/api/admin/system/tasks/history?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!resp.ok) {
        throw new Error("获取任务历史失败");
      }
      const data = await resp.json();
      setTaskHistory(Array.isArray(data.items) ? data.items : []);
      setTaskHistoryPage(data.page || 1);
      setTaskHistoryTotalPages(data.total_pages || 1);
    } catch (err) {
      showError(err.message || "获取任务历史失败");
    } finally {
      setTaskHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchTaskHistory(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-cyan-400" />
          <div>
            <div className="text-white font-semibold text-sm">分离任务历史</div>
            <div className="text-xs text-slate-400">
              查看近期所有音频分离任务的概况，便于排查问题或统计使用情况。
            </div>
          </div>
        </div>
        <button
          onClick={() => fetchTaskHistory(1)}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-700 text-white rounded-lg text-xs flex items-center gap-2"
        >
          <RotateCcw size={14} />
          刷新
        </button>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        {taskHistoryLoading ? (
          <div className="text-center text-slate-400 py-8 text-sm">加载中...</div>
        ) : taskHistory.length === 0 ? (
          <div className="text-center text-slate-400 py-8 text-sm">
            暂无分离任务历史记录。
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-900">
                  <tr>
                    <th className="px-3 py-2 text-left text-slate-400 font-medium">任务ID</th>
                    <th className="px-3 py-2 text-left text-slate-400 font-medium">用户ID</th>
                    <th className="px-3 py-2 text-left text-slate-400 font-medium">文件名</th>
                    <th className="px-3 py-2 text-left text-slate-400 font-medium">算法</th>
                    <th className="px-3 py-2 text-left text-slate-400 font-medium">模型版本</th>
                    <th className="px-3 py-2 text-left text-slate-400 font-medium">状态</th>
                    <th className="px-3 py-2 text-left text-slate-400 font-medium">创建时间</th>
                    <th className="px-3 py-2 text-left text-slate-400 font-medium">完成时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {taskHistory.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-700/40">
                      <td className="px-3 py-2 font-mono text-slate-200">{t.id}</td>
                      <td className="px-3 py-2 font-mono text-slate-300">{t.user_id || "-"}</td>
                      <td className="px-3 py-2 text-slate-100 max-w-xs truncate">
                        {t.original_filename || "(未命名)"}
                      </td>
                      <td className="px-3 py-2 text-slate-300">{t.algorithm || "-"}</td>
                      <td className="px-3 py-2 text-slate-300">{t.model_version || "-"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-1 rounded-full text-[11px] ${
                            t.status === "completed"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : t.status === "failed"
                              ? "bg-red-500/20 text-red-300"
                              : "bg-slate-600/60 text-slate-200"
                          }`}
                        >
                          {t.status || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {t.created_at ? new Date(t.created_at).toLocaleString("zh-CN") : "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {t.completed_at ? new Date(t.completed_at).toLocaleString("zh-CN") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {taskHistoryTotalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-xs text-slate-400">
                <button
                  onClick={() => fetchTaskHistory(Math.max(1, taskHistoryPage - 1))}
                  disabled={taskHistoryPage <= 1}
                  className="px-3 py-1.5 bg-slate-900 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <span>
                  第 {taskHistoryPage} / {taskHistoryTotalPages} 页
                </span>
                <button
                  onClick={() =>
                    fetchTaskHistory(Math.min(taskHistoryTotalPages, taskHistoryPage + 1))
                  }
                  disabled={taskHistoryPage >= taskHistoryTotalPages}
                  className="px-3 py-1.5 bg-slate-900 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 系统日志组件
function SystemLogs({ token }) {
  const { showSuccess, showError } = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const DEFAULT_QUERY = React.useMemo(
    () => ({
      operation_type: "",
      resource_type: "",
      user_id: "",
      username: "",
      resource_id: "",
      ip_address: "",
      keyword: "",
      status: "",
      start_date: "",
      end_date: "",
    }),
    [],
  );
  const [draft, setDraft] = useState(DEFAULT_QUERY);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [total, setTotal] = useState(0);

  const applyDraft = React.useCallback(() => {
    // 轻量归一化：去掉两端空格，空串不提交
    const normalized = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]),
    );
    setQuery(normalized);
    setPage(1);
  }, [draft]);

  const resetAll = React.useCallback(() => {
    setDraft(DEFAULT_QUERY);
    setQuery(DEFAULT_QUERY);
    setPage(1);
  }, [DEFAULT_QUERY]);

  const fetchLogs = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.operation_type) params.append("operation_type", query.operation_type);
      if (query.resource_type) params.append("resource_type", query.resource_type);
      if (query.user_id) params.append("user_id", query.user_id);
      if (query.username) params.append("username", query.username);
      if (query.resource_id) params.append("resource_id", query.resource_id);
      if (query.ip_address) params.append("ip_address", query.ip_address);
      if (query.keyword) params.append("keyword", query.keyword);
      if (query.status) params.append("status_filter", query.status);
      if (query.start_date) params.append("start_date", query.start_date);
      if (query.end_date) params.append("end_date", query.end_date);
      params.append("page", page);
      params.append("page_size", pageSize);

      const resp = await fetch(`${API_BASE}/api/admin/system/logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("获取日志失败");
      const data = await resp.json();
      setLogs(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }, [
    query.operation_type,
    query.resource_type,
    query.user_id,
    query.username,
    query.resource_id,
    query.ip_address,
    query.keyword,
    query.status,
    query.start_date,
    query.end_date,
    page,
    pageSize,
    token,
    showError,
  ]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const exportLogs = async () => {
    try {
      const params = new URLSearchParams();
      if (query.operation_type) params.append("operation_type", query.operation_type);
      if (query.resource_type) params.append("resource_type", query.resource_type);
      if (query.user_id) params.append("user_id", query.user_id);
      if (query.username) params.append("username", query.username);
      if (query.resource_id) params.append("resource_id", query.resource_id);
      if (query.ip_address) params.append("ip_address", query.ip_address);
      if (query.keyword) params.append("keyword", query.keyword);
      if (query.status) params.append("status_filter", query.status);
      if (query.start_date) params.append("start_date", query.start_date);
      if (query.end_date) params.append("end_date", query.end_date);

      const resp = await fetch(`${API_BASE}/api/admin/system/logs/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        if (resp.status === 404) {
          const errorData = await resp.json().catch(() => ({}));
          throw new Error(errorData.detail || "没有找到符合条件的日志记录");
        }
        throw new Error(`导出失败: ${resp.status} ${resp.statusText}`);
      }
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "system_logs.csv";
      a.click();
      window.URL.revokeObjectURL(url);
      showSuccess("导出成功");
    } catch (err) {
      showError(err.message || "导出失败");
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部区域：筛选和操作 */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/80 shadow-lg shadow-black/20 overflow-hidden">
        <div className="px-5 py-4 bg-gradient-to-r from-slate-900/80 to-slate-800/60 border-b border-slate-700/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <FileText size={18} className="text-cyan-400" />
            </div>
            <div className="min-w-0">
              <div className="text-white font-semibold">系统日志</div>
              <div className="text-xs text-slate-400 truncate">关键词/时间范围/用户/IP 等多条件查询</div>
            </div>
          </div>
          <button
            onClick={exportLogs}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg flex items-center justify-center gap-2 transition shadow-lg shadow-cyan-600/20 hover:shadow-cyan-600/30 font-medium"
          >
            <Download size={16} />
            导出
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 主搜索 + 常用筛选 */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-5">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">关键词</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={draft.keyword}
                  onChange={(e) => setDraft({ ...draft, keyword: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyDraft();
                  }}
                  placeholder="搜索：用户名 / 描述 / 错误信息 / 操作类型 / IP ..."
                  className="w-full pl-10 pr-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                />
              </div>
            </div>

            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">开始时间</label>
              <input
                type="datetime-local"
                value={draft.start_date}
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">结束时间</label>
              <input
                type="datetime-local"
                value={draft.end_date}
                onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
              />
            </div>

            <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">操作类型</label>
                <select
                  value={draft.operation_type}
                  onChange={(e) => setDraft({ ...draft, operation_type: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                >
                  <option value="">全部</option>
                  <option value="user_create">创建用户</option>
                  <option value="user_update">更新用户</option>
                  <option value="user_delete">删除用户</option>
                  <option value="audio_upload">上传音频</option>
                  <option value="audio_delete">删除音频</option>
                  <option value="login">登录</option>
                  <option value="logout">登出</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">资源类型</label>
                <select
                  value={draft.resource_type}
                  onChange={(e) => setDraft({ ...draft, resource_type: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                >
                  <option value="">全部</option>
                  <option value="user">用户</option>
                  <option value="audio">音频</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">状态</label>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                >
                  <option value="">全部</option>
                  <option value="success">成功</option>
                  <option value="failed">失败</option>
                </select>
              </div>
            </div>
          </div>

          {/* 操作栏 */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 hover:text-white hover:border-slate-600 transition w-fit"
            >
              <Filter size={16} className="text-cyan-400" />
              高级筛选
              {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            <div className="flex items-center gap-2 flex-wrap justify-between md:justify-end">
              <div className="px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-sm text-slate-400">
                共 <span className="text-cyan-400 font-semibold">{total}</span> 条
              </div>
              <button
                onClick={resetAll}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
              >
                <RotateCcw size={14} />
                重置
              </button>
              <button
                onClick={applyDraft}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 shadow-lg shadow-cyan-600/20 hover:shadow-cyan-600/30"
              >
                <Search size={16} />
                查询
              </button>
            </div>
          </div>

          {/* 高级筛选 */}
          {showAdvanced && (
            <div className="pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">用户ID</label>
                  <input
                    type="number"
                    min="1"
                    value={draft.user_id}
                    onChange={(e) => setDraft({ ...draft, user_id: e.target.value })}
                    placeholder="例如：10001"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">用户名</label>
                  <input
                    type="text"
                    value={draft.username}
                    onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                    placeholder="模糊匹配"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">资源ID</label>
                  <input
                    type="number"
                    min="1"
                    value={draft.resource_id}
                    onChange={(e) => setDraft({ ...draft, resource_id: e.target.value })}
                    placeholder="例如：20001"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">IP</label>
                  <input
                    type="text"
                    value={draft.ip_address}
                    onChange={(e) => setDraft({ ...draft, ip_address: e.target.value })}
                    placeholder="模糊匹配"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-700">
              <tr>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">时间</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">用户</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">操作</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">资源</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">描述</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
                      <span className="text-slate-400 text-sm">加载中...</span>
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Info size={32} className="text-slate-500" />
                      <span className="text-slate-400 text-sm">暂无日志</span>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-5 py-3.5 text-sm text-slate-300 font-mono">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : "-"}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-200 font-medium">{log.username || "-"}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-300">
                      <span className="px-2 py-1 bg-slate-700/50 rounded text-xs">{log.operation_type}</span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-300">
                      <span className="text-cyan-400">{log.resource_type}</span>
                      {log.resource_id && <span className="text-slate-500 ml-1">#{log.resource_id}</span>}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-400 max-w-md truncate" title={log.description || "-"}>
                      {log.description || "-"}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          log.status === "success"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-red-500/20 text-red-300 border border-red-500/30"
                        }`}
                      >
                        {log.status === "success" ? "成功" : "失败"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="px-5 py-4 border-t border-slate-700 bg-slate-900/50 flex items-center justify-between">
          <div className="text-sm text-slate-400">
            显示第 <span className="text-cyan-400 font-semibold">{(page - 1) * pageSize + 1}</span> - 
            <span className="text-cyan-400 font-semibold"> {Math.min(page * pageSize, total)}</span> 条，
            共 <span className="text-cyan-400 font-semibold">{total}</span> 条记录
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
            >
              上一页
            </button>
            <div className="px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-300 font-medium">
              {page} / {Math.max(1, Math.ceil(total / pageSize))}
            </div>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= Math.ceil(total / pageSize)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 系统设置组件
function SystemSettings({ token }) {
  const { showSuccess, showError } = useToast();
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    key: "",
    value: "",
    description: "",
    category: "",
  });
  const [storageMode, setStorageMode] = useState("local");
  const [savingStorageMode, setSavingStorageMode] = useState(false);
  const [computeMode, setComputeMode] = useState("gpu");
  const [savingComputeMode, setSavingComputeMode] = useState(false);
  const [modelVersions, setModelVersions] = useState({
    MDX23C: "",
    Demucs4HT: "",
    "Band Split RoFormer": "",
    SCNet: "",
  });
  const [savingModelVersions, setSavingModelVersions] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [initializing, setInitializing] = useState(false);
  const [allConfigs, setAllConfigs] = useState([]);

  const fetchConfigs = async (category = null) => {
    setLoading(true);
    try {
      // 先获取所有配置（用于分类列表）
      const allResp = await fetch(`${API_BASE}/api/admin/system/configs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!allResp.ok) throw new Error("获取配置失败");
      const allData = await allResp.json();
      setAllConfigs(allData.items || []);
      
      // 查找 storage_mode 配置（评分数据源模式，当前仅用于预留扩展）
      const storageConfig = allData.items?.find(c => c.key === "storage_mode");
      if (storageConfig) {
        setStorageMode(storageConfig.value || "local");
      }

      // 查找 separation_compute_mode 配置
      const computeConfig = allData.items?.find(c => c.key === "separation_compute_mode");
      if (computeConfig) {
        const raw = (computeConfig.value || "gpu").toString().toLowerCase();
        setComputeMode(raw === "cpu" ? "cpu" : "gpu");
      }

      // 加载各算法模型版本（管理员配置）
      const versionMap = {
        MDX23C: "",
        Demucs4HT: "",
        "Band Split RoFormer": "",
        SCNet: "",
      };
      (allData.items || []).forEach((cfg) => {
        const key = (cfg?.key || "").toString();
        if (!key.startsWith("algorithm_version.")) return;
        const algo = key.replace("algorithm_version.", "");
        if (Object.prototype.hasOwnProperty.call(versionMap, algo)) {
          versionMap[algo] = (cfg?.value || "").toString();
        }
      });
      setModelVersions(versionMap);
      
      // 如果指定了分类，则筛选
      if (category) {
        setConfigs(allData.items?.filter(c => c.category === category) || []);
      } else {
        setConfigs(allData.items || []);
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs(selectedCategory || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  const handleInitDefaults = async () => {
    if (!window.confirm("确定要初始化默认配置吗？这将创建所有常用配置项（已存在的配置不会被覆盖）。")) {
      return;
    }
    
    setInitializing(true);
    try {
      const resp = await fetch(`${API_BASE}/api/admin/system/configs/init-defaults`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.detail || "初始化失败");
      }
      
      const data = await resp.json();
      showSuccess(`初始化完成！创建 ${data.created} 个，更新 ${data.updated} 个，跳过 ${data.skipped} 个`);
      fetchConfigs(selectedCategory || null);
    } catch (err) {
      showError(err.message);
    } finally {
      setInitializing(false);
    }
  };

  // 获取所有分类
  const categories = [...new Set(allConfigs.map(c => c.category).filter(Boolean))].sort();

  const handleStorageModeChange = async (newMode) => {
    if (savingStorageMode) return;
    
    setSavingStorageMode(true);
    try {
      // 先尝试更新现有配置
      let resp = await fetch(`${API_BASE}/api/admin/system/configs/storage_mode`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          value: newMode,
          description: "评分数据源模式配置（预留扩展；当前评分统一存储于后端数据库）",
          category: "system"
        }),
      });
      
      // 如果配置不存在（404），则创建新配置
      if (!resp.ok && resp.status === 404) {
        resp = await fetch(`${API_BASE}/api/admin/system/configs`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            key: "storage_mode",
            value: newMode,
            description: "评分数据源模式配置（预留扩展；当前评分统一存储于后端数据库）",
            category: "system",
          }),
        });
      }
      
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.detail || "保存失败");
      }
      
      setStorageMode(newMode);
      showSuccess(`评分数据源模式已更新为：${newMode === "local" ? "后端数据库" : "预留扩展模式"}`);
      fetchConfigs(); // 刷新配置列表
    } catch (err) {
      showError(err.message);
    } finally {
      setSavingStorageMode(false);
    }
  };

  const handleComputeModeChange = async (newMode) => {
    if (savingComputeMode) return;

    setSavingComputeMode(true);
    try {
      // 更新或创建 separation_compute_mode 配置
      let resp = await fetch(`${API_BASE}/api/admin/system/configs/separation_compute_mode`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          value: newMode,
          description: "分离任务运行模式：cpu 或 gpu（仅在支持 GPU 的环境下生效）",
          category: "separation",
        }),
      });

      // 理论上不会返回 404（不存在时会创建），但保留兜底逻辑
      if (!resp.ok && resp.status === 404) {
        resp = await fetch(`${API_BASE}/api/admin/system/configs`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            key: "separation_compute_mode",
            value: newMode,
            description: "分离任务运行模式：cpu 或 gpu（仅在支持 GPU 的环境下生效）",
            category: "separation",
          }),
        });
      }

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.detail || "保存失败");
      }

      setComputeMode(newMode);
      showSuccess(`分离任务运行模式已切换为：${newMode === "cpu" ? "CPU" : "GPU"}`);
      fetchConfigs(); // 刷新配置列表
    } catch (err) {
      showError(err.message);
    } finally {
      setSavingComputeMode(false);
    }
  };

  const handleSaveModelVersions = async () => {
    if (savingModelVersions) return;
    setSavingModelVersions(true);
    try {
      const entries = Object.entries(modelVersions || {});
      for (const [algo, version] of entries) {
        const resp = await fetch(`${API_BASE}/api/admin/system/configs/${encodeURIComponent(`algorithm_version.${algo}`)}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            value: (version || "").toString().trim(),
            description: `算法 ${algo} 的模型版本号（用于任务记录与论文追踪）`,
            category: "separation",
          }),
        });
        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          throw new Error(errBody.detail || `保存 ${algo} 版本失败`);
        }
      }
      showSuccess("模型版本配置已保存");
      fetchConfigs(selectedCategory || null);
    } catch (err) {
      showError(err.message || "保存模型版本失败");
    } finally {
      setSavingModelVersions(false);
    }
  };

  const handleEdit = (config) => {
    setEditingKey(config.key);
    setEditValue(config.value || "");
  };

  const handleSave = async (key) => {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/system/configs/${key}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value: editValue }),
      });
      if (!resp.ok) throw new Error("保存失败");
      showSuccess("配置已保存");
      setEditingKey(null);
      fetchConfigs();
    } catch (err) {
      showError(err.message);
    }
  };

  const handleCreate = async () => {
    try {
      if (!createForm.key.trim()) {
        showError("配置键不能为空");
        return;
      }
      const resp = await fetch(`${API_BASE}/api/admin/system/configs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: createForm.key.trim(),
          value: createForm.value,
          description: createForm.description || null,
          category: createForm.category || null,
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.detail || "创建失败");
      }
      showSuccess("配置已创建");
      setShowCreate(false);
      setCreateForm({ key: "", value: "", description: "", category: "" });
      fetchConfigs();
    } catch (err) {
      showError(err.message);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail.trim()) {
      showError("请输入邮箱地址");
      return;
    }
    
    // 简单的邮箱格式验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(testEmail.trim())) {
      showError("请输入有效的邮箱地址");
      return;
    }

    setTestingEmail(true);
    try {
      const resp = await fetch(`${API_BASE}/api/auth/test_email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: testEmail.trim() }),
      });
      
      const data = await resp.json();
      
      if (data.status === "success") {
        showSuccess(data.message);
        if (data.details) {
          setTimeout(() => showSuccess(data.details), 1000);
        }
      } else {
        showError(data.message || "邮件发送失败");
        if (data.suggestion) {
          setTimeout(() => showError(data.suggestion), 1000);
        }
      }
    } catch (err) {
      showError(err.message || "测试邮件发送失败");
    } finally {
      setTestingEmail(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Settings size={18} className="text-cyan-400" />
            <span>系统配置管理</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleInitDefaults}
              disabled={initializing}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {initializing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  初始化中...
                </>
              ) : (
                <>
                  <Settings size={16} />
                  初始化默认配置
                </>
              )}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg flex items-center gap-2"
            >
              <Plus size={16} />
              新增配置
            </button>
          </div>
        </div>
      </div>

      {/* 数据源切换 */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white mb-2">评分数据源（预留扩展）</h3>
            <p className="text-sm text-slate-400">
              当前所有评分数据统一存储在后端数据库。此处的数据源模式用于未来扩展（例如外部评测平台），暂不改变实际存储行为。
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleStorageModeChange("local")}
                disabled={savingStorageMode || storageMode === "local"}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  storageMode === "local"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                } ${savingStorageMode ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full bg-emerald-400`}></span>
                  后端数据库（当前实现）
                </span>
              </button>
              <button
                onClick={() => handleStorageModeChange("firestore")}
                disabled={savingStorageMode || storageMode === "firestore"}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  storageMode === "firestore"
                    ? "bg-purple-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                } ${savingStorageMode ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full bg-purple-400`}></span>
                  预留扩展模式
                </span>
              </button>
            </div>
          </div>
        </div>
        {savingStorageMode && (
          <div className="mt-4 text-sm text-slate-400">正在保存...</div>
        )}
      </div>

      {/* 计算运行模式切换（CPU / GPU） */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white mb-2">分离任务运行模式</h3>
            <p className="text-sm text-slate-400">
              切换音频分离任务在后端运行时使用的计算设备（CPU 或 GPU）。GPU 模式依赖环境已正确安装 CUDA / PyTorch。
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleComputeModeChange("cpu")}
                disabled={savingComputeMode || computeMode === "cpu"}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  computeMode === "cpu"
                    ? "bg-slate-100 text-slate-900"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                } ${savingComputeMode ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  CPU
                </span>
              </button>
              <button
                onClick={() => handleComputeModeChange("gpu")}
                disabled={savingComputeMode || computeMode === "gpu"}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  computeMode === "gpu"
                    ? "bg-cyan-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                } ${savingComputeMode ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                  GPU
                </span>
              </button>
            </div>
          </div>
        </div>
        {savingComputeMode && (
          <div className="mt-4 text-sm text-slate-400">正在保存运行模式...</div>
        )}
      </div>

      {/* 模型版本配置（论文追踪） */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-white mb-2">算法模型版本配置</h3>
            <p className="text-sm text-slate-400">
              由管理员维护每个算法当前使用的模型版本号。新建分离任务时会自动记录该版本信息，便于论文复现与对比追踪。
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.keys(modelVersions || {}).map((algo) => (
            <div key={algo}>
              <label className="block text-xs text-slate-400 mb-1.5">{algo} 版本</label>
              <input
                type="text"
                value={modelVersions[algo] || ""}
                onChange={(e) =>
                  setModelVersions((prev) => ({ ...(prev || {}), [algo]: e.target.value }))
                }
                placeholder="例如：v1.0.3 / 2026-03-22"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              />
            </div>
          ))}
        </div>
        <div className="mt-4">
          <button
            onClick={handleSaveModelVersions}
            disabled={savingModelVersions}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingModelVersions ? "保存中..." : "保存模型版本"}
          </button>
        </div>
      </div>

      {/* 邮箱测试 */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div className="flex items-center gap-3 mb-4">
          <Mail size={20} className="text-cyan-400" />
          <h3 className="text-lg font-bold text-white">邮箱测试</h3>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          测试系统邮件发送功能是否正常工作。测试邮件将发送验证码到指定邮箱。
        </p>
        <div className="flex items-center gap-3">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="请输入测试邮箱地址"
            className="flex-1 px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            disabled={testingEmail}
          />
          <button
            onClick={handleTestEmail}
            disabled={testingEmail || !testEmail.trim()}
            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {testingEmail ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                发送中...
              </>
            ) : (
              <>
                <Send size={16} />
                发送测试邮件
              </>
            )}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-2">配置键 *</label>
              <input
                type="text"
                value={createForm.key}
                onChange={(e) => setCreateForm({ ...createForm, key: e.target.value })}
                placeholder="例如：upload.max_file_mb"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-2">配置值</label>
              <input
                type="text"
                value={createForm.value}
                onChange={(e) => setCreateForm({ ...createForm, value: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-2">分类</label>
              <input
                type="text"
                value={createForm.category}
                onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                placeholder="例如：upload/security/email/system"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-2">描述</label>
              <input
                type="text"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg"
            >
              创建
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 分类筛选 */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-slate-400">筛选分类：</span>
          <button
            onClick={() => setSelectedCategory("")}
            className={`px-3 py-1 rounded-lg text-sm transition ${
              selectedCategory === ""
                ? "bg-cyan-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            全部
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                selectedCategory === cat
                  ? "bg-cyan-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">配置键</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">配置值</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">分类</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">描述</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    加载中...
                  </td>
                </tr>
              ) : configs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    {selectedCategory ? `分类 "${selectedCategory}" 下暂无配置` : "暂无配置"}
                  </td>
                </tr>
              ) : (
                configs.map((config, index) => (
                  <tr key={config.key || `config-${config.id || index}`} className="hover:bg-slate-700/50">
                    <td className="px-4 py-3 text-sm text-slate-300 font-mono">{config.key}</td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {editingKey === config.key ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleSave(config.key);
                            } else if (e.key === "Escape") {
                              setEditingKey(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="text-slate-400 font-mono text-xs">{config.value || "-"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {config.category ? (
                        <span className="px-2 py-1 bg-slate-700 text-slate-300 rounded text-xs">
                          {config.category}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">{config.description || "-"}</td>
                    <td className="px-4 py-3">
                      {editingKey === config.key ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSave(config.key)}
                            className="px-3 py-1 bg-cyan-600 hover:bg-cyan-700 text-white rounded text-sm flex items-center gap-1"
                          >
                            <Save size={14} />
                            保存
                          </button>
                          <button
                            onClick={() => setEditingKey(null)}
                            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEdit(config)}
                          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
                        >
                          编辑
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 通知中心组件
function Notifications({ token }) {
  const { showSuccess, showError } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    content: "",
    type: "info",
    target_type: "all",
  });

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/admin/system/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("获取通知失败");
      const data = await resp.json();
      setNotifications(data.items || []);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/system/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setUnreadCount(data.count || 0);
      }
    } catch (err) {
      // 忽略错误
    }
  };

  useEffect(() => {
    fetchNotifications();
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000); // 每30秒刷新一次
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markAsRead = async (id) => {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/system/notifications/${id}/read`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("标记失败");
      const data = await resp.json().catch(() => ({}));

      // 本地更新这条通知的已读状态
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, is_read: true, read_at: data.notification?.read_at || n.read_at } : n
        )
      );

      // 更新未读数量
      if (typeof data.unread_count === "number") {
        setUnreadCount(data.unread_count);
      } else {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }

      // 再调一次未读统计，确保和后端一致
      fetchUnreadCount();
    } catch (err) {
      showError(err.message);
    }
  };

  const createNotification = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/system/notifications`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createForm),
      });
      if (!resp.ok) throw new Error("创建失败");
      showSuccess("通知已创建");
      setShowCreate(false);
      setCreateForm({ title: "", content: "", type: "info", target_type: "all" });
      fetchNotifications();
    } catch (err) {
      showError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Bell size={18} className="text-cyan-400" />
              <span>通知管理</span>
            </div>
            {unreadCount > 0 && (
              <span className="px-3 py-1.5 bg-red-500 text-white text-sm rounded-full font-medium">
                {unreadCount} 条未读
              </span>
            )}
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg flex items-center gap-2"
          >
            <Plus size={16} />
            创建通知
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-2">标题</label>
              <input
                type="text"
                value={createForm.title}
                onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-2">内容</label>
              <textarea
                value={createForm.content}
                onChange={(e) => setCreateForm({ ...createForm, content: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-2">类型</label>
                <select
                  value={createForm.type}
                  onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                >
                  <option value="info">信息</option>
                  <option value="warning">警告</option>
                  <option value="error">错误</option>
                  <option value="success">成功</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-2">目标</label>
                <select
                  value={createForm.target_type}
                  onChange={(e) => setCreateForm({ ...createForm, target_type: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                >
                  <option value="all">所有人</option>
                  <option value="expert">专家</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={createNotification}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg"
              >
                创建
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notifications List */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center text-slate-400 py-8">加载中...</div>
        ) : notifications.length === 0 ? (
          <div className="text-center text-slate-400 py-8">暂无通知</div>
        ) : (
          notifications.map((notif) => (
            <div
              key={notif.id}
              className={`bg-slate-800 rounded-lg p-4 border border-slate-700 ${
                !notif.is_read ? "border-cyan-500" : ""
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-white font-medium">{notif.title}</h3>
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        notif.type === "info"
                          ? "bg-blue-500/20 text-blue-300"
                          : notif.type === "warning"
                          ? "bg-yellow-500/20 text-yellow-300"
                          : notif.type === "error"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-emerald-500/20 text-emerald-300"
                      }`}
                    >
                      {notif.type}
                    </span>
                    {!notif.is_read && (
                      <span className="px-2 py-1 bg-cyan-500 text-white text-xs rounded-full">
                        未读
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-sm mb-2">{notif.content}</p>
                  <p className="text-xs text-slate-500">
                    {notif.created_at ? new Date(notif.created_at).toLocaleString() : ""}
                  </p>
                </div>
                {!notif.is_read && (
                  <button
                    onClick={() => markAsRead(notif.id)}
                    className="px-3 py-1 bg-cyan-600 hover:bg-cyan-700 text-white rounded text-sm"
                  >
                    标记已读
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// 数据统计组件
function Analytics({ token }) {
  const { showError } = useToast();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const resp = await fetch(`${API_BASE}/api/admin/system/analytics/stats?days=${days}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error("获取统计失败");
        const data = await resp.json();
        setStats(data);
      } catch (err) {
        showError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, token]);

  // 格式化日期显示
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  // 格式化存储大小
  const formatStorage = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  // 图表颜色配置
  const COLORS = [
    "#06b6d4", // cyan-500
    "#10b981", // emerald-500
    "#8b5cf6", // purple-500
    "#f59e0b", // amber-500
    "#ef4444", // red-500
    "#3b82f6", // blue-500
    "#ec4899", // pink-500
    "#14b8a6", // teal-500
  ];

  // 图表下载功能
  const downloadChart = async (chartRef, filename) => {
    if (!chartRef.current) return;
    
    try {
      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: "#1e293b",
        scale: 2,
        logging: false,
      });
      
      const url = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `${filename}_${new Date().toISOString().split("T")[0]}.png`;
      link.href = url;
      link.click();
    } catch (err) {
      showError("图表导出失败：" + (err?.message || String(err)));
    }
  };

  // 为每个图表创建 ref
  const userGrowthRef = useRef(null);
  const activeUsersRef = useRef(null);
  const resourceUploadRef = useRef(null);
  const downloadTrendRef = useRef(null);
  const resourceFormatRef = useRef(null);
  const resourceCategoryRef = useRef(null);
  const operationStatsRef = useRef(null);
  const taskStatsRef = useRef(null);
  const userRoleRef = useRef(null);

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <BarChart3 size={18} className="text-cyan-400" />
            <span>数据统计分析</span>
          </div>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
          >
            <option value={7}>最近7天</option>
            <option value={30}>最近30天</option>
            <option value={90}>最近90天</option>
            <option value={365}>最近一年</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-8">加载中...</div>
      ) : stats ? (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-slate-400">总用户数</div>
                <Users size={18} className="text-cyan-400" />
              </div>
              <div className="text-3xl font-bold text-white">{stats.total_users || 0}</div>
              <div className="text-xs text-slate-500 mt-1">
                活跃: {stats.active_users || 0} 人
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-slate-400">总下载次数</div>
                <Download size={18} className="text-cyan-400" />
              </div>
              <div className="text-3xl font-bold text-cyan-400">{stats.total_downloads || 0}</div>
              <div className="text-xs text-slate-500 mt-1">
                资源数: {stats.total_resources || 0}
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-slate-400">总任务数</div>
                <Activity size={18} className="text-emerald-400" />
              </div>
              <div className="text-3xl font-bold text-emerald-400">{stats.total_tasks || 0}</div>
              <div className="text-xs text-slate-500 mt-1">
                存储: {formatStorage(stats.total_storage || 0)}
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-slate-400">用户增长</div>
                <BarChart3 size={18} className="text-purple-400" />
              </div>
              <div className="text-3xl font-bold text-purple-400">
                {stats.new_users_in_period ?? (stats.user_growth?.reduce((sum, item) => sum + item.count, 0) || 0)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                统计期内新增
              </div>
            </div>
          </div>

          {/* 用户增长趋势图 */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">用户增长趋势</h3>
              <button
                onClick={() => downloadChart(userGrowthRef, "用户增长趋势")}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
              >
                <Download size={14} />
                下载
              </button>
            </div>
            <div ref={userGrowthRef}>
              <ResponsiveContainer width="100%" height={300}>
              <LineChart data={stats.user_growth || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  tickFormatter={formatDate}
                  style={{ fontSize: "12px" }}
                />
                <YAxis stroke="#94a3b8" style={{ fontSize: "12px" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    border: "1px solid #475569",
                    borderRadius: "8px",
                    color: "#f1f5f9",
                  }}
                  labelFormatter={(value) => `日期: ${formatDate(value)}`}
                />
                <Legend wrapperStyle={{ color: "#94a3b8" }} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  name="新增用户"
                  dot={{ fill: "#06b6d4", r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
            </div>
          </div>

          {/* 活跃用户趋势图 */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">活跃用户趋势</h3>
              <button
                onClick={() => downloadChart(activeUsersRef, "活跃用户趋势")}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
              >
                <Download size={14} />
                下载
              </button>
            </div>
            <div ref={activeUsersRef}>
              <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={stats.active_users_daily || []}>
                <defs>
                  <linearGradient id="colorActiveUsers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  tickFormatter={formatDate}
                  style={{ fontSize: "12px" }}
                />
                <YAxis stroke="#94a3b8" style={{ fontSize: "12px" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    border: "1px solid #475569",
                    borderRadius: "8px",
                    color: "#f1f5f9",
                  }}
                  labelFormatter={(value) => `日期: ${formatDate(value)}`}
                />
                <Legend wrapperStyle={{ color: "#94a3b8" }} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#10b981"
                  fillOpacity={1}
                  fill="url(#colorActiveUsers)"
                  name="活跃用户数"
                />
              </AreaChart>
            </ResponsiveContainer>
            </div>
          </div>

          {/* 资源上传趋势和下载趋势 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">资源上传趋势</h3>
                <button
                  onClick={() => downloadChart(resourceUploadRef, "资源上传趋势")}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
                >
                  <Download size={14} />
                  下载
                </button>
              </div>
              <div ref={resourceUploadRef}>
                <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stats.resource_upload || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                  <XAxis
                    dataKey="date"
                    stroke="#94a3b8"
                    tickFormatter={formatDate}
                    style={{ fontSize: "11px" }}
                  />
                  <YAxis stroke="#94a3b8" style={{ fontSize: "11px" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #475569",
                      borderRadius: "8px",
                      color: "#f1f5f9",
                    }}
                    labelFormatter={(value) => `日期: ${formatDate(value)}`}
                  />
                  <Bar dataKey="count" fill="#8b5cf6" name="上传数量" />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">下载趋势</h3>
                <button
                  onClick={() => downloadChart(downloadTrendRef, "下载趋势")}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
                >
                  <Download size={14} />
                  下载
                </button>
              </div>
              <div ref={downloadTrendRef}>
                <ResponsiveContainer width="100%" height={250}>
                <LineChart data={stats.download_trend || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                  <XAxis
                    dataKey="date"
                    stroke="#94a3b8"
                    tickFormatter={formatDate}
                    style={{ fontSize: "11px" }}
                  />
                  <YAxis stroke="#94a3b8" style={{ fontSize: "11px" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #475569",
                      borderRadius: "8px",
                      color: "#f1f5f9",
                    }}
                    labelFormatter={(value) => `日期: ${formatDate(value)}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="downloads"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    name="下载数"
                    dot={{ fill: "#f59e0b", r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* 资源类型分布和分类分布 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">资源类型分布</h3>
                <button
                  onClick={() => downloadChart(resourceFormatRef, "资源类型分布")}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
                >
                  <Download size={14} />
                  下载
                </button>
              </div>
              {stats.resource_format_dist && stats.resource_format_dist.length > 0 ? (
                <div ref={resourceFormatRef}>
                  <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={stats.resource_format_dist}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ format, count, percent }) =>
                        `${format}: ${(percent * 100).toFixed(0)}%`
                      }
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="count"
                    >
                      {stats.resource_format_dist.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #475569",
                        borderRadius: "8px",
                        color: "#f1f5f9",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-center text-slate-400 py-12">暂无数据</div>
              )}
            </div>

            <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">资源分类分布</h3>
                <button
                  onClick={() => downloadChart(resourceCategoryRef, "资源分类分布")}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
                >
                  <Download size={14} />
                  下载
                </button>
              </div>
              {stats.resource_category_dist && stats.resource_category_dist.length > 0 ? (
                <div ref={resourceCategoryRef}>
                  <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stats.resource_category_dist} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                    <XAxis type="number" stroke="#94a3b8" style={{ fontSize: "11px" }} />
                    <YAxis
                      dataKey="category"
                      type="category"
                      stroke="#94a3b8"
                      style={{ fontSize: "11px" }}
                      width={100}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #475569",
                        borderRadius: "8px",
                        color: "#f1f5f9",
                      }}
                    />
                    <Bar dataKey="count" fill="#3b82f6" name="数量" />
                  </BarChart>
                </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-center text-slate-400 py-12">暂无数据</div>
              )}
            </div>
          </div>

          {/* 操作类型统计和任务状态统计 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">操作类型统计</h3>
                <button
                  onClick={() => downloadChart(operationStatsRef, "操作类型统计")}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
                >
                  <Download size={14} />
                  下载
                </button>
              </div>
              {stats.operation_stats && stats.operation_stats.length > 0 ? (
                <div ref={operationStatsRef}>
                  <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stats.operation_stats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                    <XAxis
                      dataKey="operation_type"
                      stroke="#94a3b8"
                      style={{ fontSize: "11px" }}
                      angle={-45}
                      textAnchor="end"
                      height={100}
                    />
                    <YAxis stroke="#94a3b8" style={{ fontSize: "11px" }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #475569",
                        borderRadius: "8px",
                        color: "#f1f5f9",
                      }}
                    />
                    <Bar dataKey="count" fill="#ec4899" name="操作次数" />
                  </BarChart>
                </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-center text-slate-400 py-12">暂无数据</div>
              )}
            </div>

            <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">任务状态统计</h3>
                <button
                  onClick={() => downloadChart(taskStatsRef, "任务状态统计")}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
                >
                  <Download size={14} />
                  下载
                </button>
              </div>
              {stats.task_stats && stats.task_stats.length > 0 ? (
                <div ref={taskStatsRef}>
                  <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={stats.task_stats}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ status, percent }) =>
                        `${status}: ${(percent * 100).toFixed(0)}%`
                      }
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="count"
                    >
                      {stats.task_stats.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #475569",
                        borderRadius: "8px",
                        color: "#f1f5f9",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-center text-slate-400 py-12">暂无数据</div>
              )}
            </div>
          </div>

          {/* 用户角色分布 */}
          {stats.user_role_dist && stats.user_role_dist.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">用户角色分布</h3>
                <button
                  onClick={() => downloadChart(userRoleRef, "用户角色分布")}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
                >
                  <Download size={14} />
                  下载
                </button>
              </div>
              <div ref={userRoleRef}>
                <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.user_role_dist}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                  <XAxis
                    dataKey="role"
                    stroke="#94a3b8"
                    style={{ fontSize: "12px" }}
                  />
                  <YAxis stroke="#94a3b8" style={{ fontSize: "12px" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #475569",
                      borderRadius: "8px",
                      color: "#f1f5f9",
                    }}
                  />
                  <Bar dataKey="count" fill="#14b8a6" name="用户数" />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

