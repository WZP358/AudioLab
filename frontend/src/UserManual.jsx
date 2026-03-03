import React, { useEffect, useMemo, useState } from "react";
import { FileText, ArrowLeft, Download, RotateCcw, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export default function UserManual({ onBack }) {
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
        <h1 className="text-2xl font-bold text-white mt-6 mb-3" {...props}>
          {children}
        </h1>
      ),
      h2: ({ children, ...props }) => (
        <h2 className="text-xl font-bold text-white mt-6 mb-3" {...props}>
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3 className="text-lg font-semibold text-white mt-5 mb-2" {...props}>
          {children}
        </h3>
      ),
      p: ({ children, ...props }) => (
        <p className="text-sm text-slate-200 leading-relaxed my-3" {...props}>
          {children}
        </p>
      ),
      a: ({ children, ...props }) => (
        <a
          className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
          {...props}
        >
          {children}
        </a>
      ),
      ul: ({ children, ...props }) => (
        <ul className="list-disc pl-5 my-3 space-y-1 text-slate-200" {...props}>
          {children}
        </ul>
      ),
      ol: ({ children, ...props }) => (
        <ol className="list-decimal pl-5 my-3 space-y-1 text-slate-200" {...props}>
          {children}
        </ol>
      ),
      li: ({ children, ...props }) => (
        <li className="text-sm text-slate-200" {...props}>
          {children}
        </li>
      ),
      code: ({ children, ...props }) => (
        <code
          className="px-1 py-0.5 rounded bg-slate-900/70 border border-slate-700/60 text-slate-100"
          {...props}
        >
          {children}
        </code>
      ),
      pre: ({ children, ...props }) => (
        <pre
          className="p-4 rounded-lg bg-slate-900/70 border border-slate-700/60 overflow-auto my-4"
          {...props}
        >
          {children}
        </pre>
      ),
      blockquote: ({ children, ...props }) => (
        <blockquote
          className="border-l-2 border-cyan-500/60 pl-4 py-1 my-4 text-slate-200/90"
          {...props}
        >
          {children}
        </blockquote>
      ),
      hr: (props) => <hr className="border-slate-700/70 my-6" {...props} />,
      table: (props) => (
        <div className="overflow-auto my-4">
          <table className="min-w-full text-sm border border-slate-700/60" {...props} />
        </div>
      ),
      th: (props) => <th className="px-3 py-2 bg-slate-800/70 border border-slate-700/60 text-left text-slate-100" {...props} />,
      td: (props) => <td className="px-3 py-2 border border-slate-700/60 text-slate-200" {...props} />,
    }),
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileText className="text-cyan-400" size={22} />
            用户说明书
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            文档来源：<span className="font-mono text-slate-300">AudioLab/用户说明书.md</span>（通过后端接口加载）
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`${API_BASE}/user-manual.md`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700/60 bg-slate-800/60 text-sm text-slate-200 hover:border-cyan-500/70 hover:text-white hover:bg-slate-800 transition"
            title="打开/下载 Markdown 原文"
          >
            <Download size={16} className="text-slate-300" />
            原文
          </a>
          <button
            type="button"
            onClick={() => fetchManual()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700/60 bg-slate-800/60 text-sm text-slate-200 hover:border-cyan-500/70 hover:text-white hover:bg-slate-800 transition"
            title="重新加载"
          >
            <RotateCcw size={16} className="text-slate-300" />
            刷新
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700/60 bg-slate-800/60 text-sm text-slate-200 hover:border-cyan-500/70 hover:text-white hover:bg-slate-800 transition"
            title="返回工作台"
          >
            <ArrowLeft size={16} className="text-slate-300" />
            返回
          </button>
        </div>
      </div>

      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        {loading && (
          <div className="text-sm text-slate-300">
            正在加载说明书内容...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-500/30 bg-red-900/10 p-4 text-sm text-red-200">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-red-300 mt-0.5" />
              <div className="space-y-2">
                <div className="font-semibold">加载失败</div>
                <div className="text-red-200/90 break-words">{error}</div>
                <div className="text-xs text-red-200/80">
                  请确认仓库根目录存在 <span className="font-mono">用户说明书.md</span>，并且后端可访问 <span className="font-mono">/user-manual.md</span>。
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && (!md || !md.trim()) && (
          <div className="text-sm text-slate-300 space-y-2">
            <div className="text-slate-200 font-semibold">说明书暂无内容</div>
            <div className="text-slate-400">
              当前检测到 <span className="font-mono text-slate-300">AudioLab/用户说明书.md</span> 为空文件。把内容写进去后，刷新本页即可显示。
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

