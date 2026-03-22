import React, { useEffect, useMemo, useState } from "react";
import { FileText, ArrowLeft, Download, RotateCcw, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "./ThemeContext";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export default function UserManual({ onBack }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [md, setMd] = useState("");

  const fetchManual = async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${API_BASE}/user-manual.md`, {
        headers: { "Cache-Control": "no-cache" },
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text || `加载失败：${resp.status} ${resp.statusText}`);
      }
      const text = await resp.text();
      setMd(text || "");
    } catch (e) {
      setError(e?.message || String(e));
      setMd("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchManual();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markdownComponents = useMemo(
    () => ({
      h1: ({ children, ...props }) => (
        <h1 className={`text-2xl font-bold mt-6 mb-3 ${isDark ? "text-white" : "text-slate-900"}`} {...props}>
          {children}
        </h1>
      ),
      h2: ({ children, ...props }) => (
        <h2 className={`text-xl font-bold mt-6 mb-3 ${isDark ? "text-white" : "text-slate-900"}`} {...props}>
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3 className={`text-lg font-semibold mt-5 mb-2 ${isDark ? "text-white" : "text-slate-900"}`} {...props}>
          {children}
        </h3>
      ),
      p: ({ children, ...props }) => (
        <p className={`text-sm leading-relaxed my-3 ${isDark ? "text-slate-200" : "text-slate-700"}`} {...props}>
          {children}
        </p>
      ),
      a: ({ children, ...props }) => (
        <a
          className={isDark ? "text-cyan-300 hover:text-cyan-200 underline underline-offset-2" : "text-cyan-700 hover:text-cyan-800 underline underline-offset-2"}
          {...props}
        >
          {children}
        </a>
      ),
      ul: ({ children, ...props }) => (
        <ul className={`list-disc pl-5 my-3 space-y-1 ${isDark ? "text-slate-200" : "text-slate-700"}`} {...props}>
          {children}
        </ul>
      ),
      ol: ({ children, ...props }) => (
        <ol className={`list-decimal pl-5 my-3 space-y-1 ${isDark ? "text-slate-200" : "text-slate-700"}`} {...props}>
          {children}
        </ol>
      ),
      li: ({ children, ...props }) => (
        <li className={`text-sm ${isDark ? "text-slate-200" : "text-slate-700"}`} {...props}>
          {children}
        </li>
      ),
      code: ({ children, ...props }) => (
        <code
          className={`px-1 py-0.5 rounded border ${isDark ? "bg-slate-900/70 border-slate-700/60 text-slate-100" : "bg-slate-100 border-slate-300 text-slate-800"}`}
          {...props}
        >
          {children}
        </code>
      ),
      pre: ({ children, ...props }) => (
        <pre
          className={`p-4 rounded-lg border overflow-auto my-4 ${isDark ? "bg-slate-900/70 border-slate-700/60" : "bg-slate-100 border-slate-300"}`}
          {...props}
        >
          {children}
        </pre>
      ),
      blockquote: ({ children, ...props }) => (
        <blockquote
          className={`border-l-2 border-cyan-500/60 pl-4 py-1 my-4 ${isDark ? "text-slate-200/90" : "text-slate-700"}`}
          {...props}
        >
          {children}
        </blockquote>
      ),
      hr: (props) => <hr className={`my-6 ${isDark ? "border-slate-700/70" : "border-slate-300"}`} {...props} />,
      table: (props) => (
        <div className="overflow-auto my-4">
          <table className={`min-w-full text-sm border ${isDark ? "border-slate-700/60" : "border-slate-300"}`} {...props} />
        </div>
      ),
      th: (props) => <th className={`px-3 py-2 border text-left ${isDark ? "bg-slate-800/70 border-slate-700/60 text-slate-100" : "bg-slate-100 border-slate-300 text-slate-800"}`} {...props} />,
      td: (props) => <td className={`px-3 py-2 border ${isDark ? "border-slate-700/60 text-slate-200" : "border-slate-300 text-slate-700"}`} {...props} />,
    }),
    [isDark],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className={`text-2xl font-bold flex items-center gap-2 ${isDark ? "text-white" : "text-slate-800"}`}>
            <FileText className="text-cyan-400" size={22} />
            用户说明书
          </h2>
          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-600"}`}>
            文档来源：<span className={`font-mono ${isDark ? "text-slate-300" : "text-slate-700"}`}>AudioLab/用户说明书.md</span>（通过后端接口加载）
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`${API_BASE}/user-manual.md`}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition ${
              isDark
                ? "border-slate-700/60 bg-slate-800/60 text-slate-200 hover:border-cyan-500/70 hover:text-white hover:bg-slate-800"
                : "border-slate-300 bg-white text-slate-700 hover:border-cyan-500/70 hover:text-slate-900 hover:bg-slate-50"
            }`}
            title="打开/下载 Markdown 原文"
          >
            <Download size={16} className={isDark ? "text-slate-300" : "text-slate-600"} />
            原文
          </a>
          <button
            type="button"
            onClick={() => fetchManual()}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition ${
              isDark
                ? "border-slate-700/60 bg-slate-800/60 text-slate-200 hover:border-cyan-500/70 hover:text-white hover:bg-slate-800"
                : "border-slate-300 bg-white text-slate-700 hover:border-cyan-500/70 hover:text-slate-900 hover:bg-slate-50"
            }`}
            title="重新加载"
          >
            <RotateCcw size={16} className={isDark ? "text-slate-300" : "text-slate-600"} />
            刷新
          </button>
          <button
            type="button"
            onClick={onBack}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition ${
              isDark
                ? "border-slate-700/60 bg-slate-800/60 text-slate-200 hover:border-cyan-500/70 hover:text-white hover:bg-slate-800"
                : "border-slate-300 bg-white text-slate-700 hover:border-cyan-500/70 hover:text-slate-900 hover:bg-slate-50"
            }`}
            title="返回工作台"
          >
            <ArrowLeft size={16} className={isDark ? "text-slate-300" : "text-slate-600"} />
            返回
          </button>
        </div>
      </div>

      <div className={`rounded-xl p-6 border ${isDark ? "bg-slate-800/50 border-slate-700/50" : "bg-white border-slate-200 shadow-sm"}`}>
        {loading && (
          <div className={`text-sm ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            正在加载说明书内容...
          </div>
        )}

        {!loading && error && (
          <div className={`rounded-lg border p-4 text-sm ${isDark ? "border-red-500/30 bg-red-900/10 text-red-200" : "border-red-300 bg-red-50 text-red-700"}`}>
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className={`mt-0.5 ${isDark ? "text-red-300" : "text-red-500"}`} />
              <div className="space-y-2">
                <div className="font-semibold">加载失败</div>
                <div className={`break-words ${isDark ? "text-red-200/90" : "text-red-600"}`}>{error}</div>
                <div className={`text-xs ${isDark ? "text-red-200/80" : "text-red-600/80"}`}>
                  请确认仓库根目录存在 <span className="font-mono">用户说明书.md</span>，并且后端可访问 <span className="font-mono">/user-manual.md</span>。
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && (!md || !md.trim()) && (
          <div className={`text-sm space-y-2 ${isDark ? "text-slate-300" : "text-slate-700"}`}>
            <div className={`font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>说明书暂无内容</div>
            <div className={isDark ? "text-slate-400" : "text-slate-600"}>
              当前检测到 <span className={`font-mono ${isDark ? "text-slate-300" : "text-slate-700"}`}>AudioLab/用户说明书.md</span> 为空文件。把内容写进去后，刷新本页即可显示。
            </div>
          </div>
        )}

        {!loading && !error && md && md.trim() && (
          <div className="max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {md}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

