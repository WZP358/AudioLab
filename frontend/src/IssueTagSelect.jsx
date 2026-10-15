import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, Check, Plus, X } from "lucide-react";

/**
 * 标准化听感问题标签选择器：下拉 + 搜索 + 自定义。
 * - selected / onChange：受控的多选标签列表（外部传入，标签变化时回传完整列表）。
 * - 用户输入的自定义标签会通过 /api/standard-labels/ensure 自动新增为标准标签，供后续复用。
 */
export default function IssueTagSelect({
  stemName,
  selected = [],
  onChange,
  authToken,
  apiBase,
  isDark,
  showError,
  placeholder = "搜索或输入自定义问题标签…",
}) {
  const [options, setOptions] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const rootRef = useRef(null);

  // 拉取该声源下的标准标签，以数据库为准：数据库没有则为空，不再使用前端写死的兜底列表。
  useEffect(() => {
    let cancelled = false;
    if (!authToken || !apiBase) {
      setOptions([]);
      return;
    }
    fetch(`${apiBase}/api/standard-labels?stem_name=${encodeURIComponent(stemName)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((resp) => (resp.ok ? resp.json() : []))
      .then((items) => {
        if (cancelled) return;
        const labels = (Array.isArray(items) ? items : []).map((i) => i.label).filter(Boolean);
        // 合并当前已选标签，保证「已选但已被管理员删除」的标签仍能通过下拉取消选择。
        setOptions(Array.from(new Set([...labels, ...selected])));
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [stemName, authToken, apiBase]);

  // 点击组件外部时收起下拉。
  useEffect(() => {
    const onDoc = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggle = (tag) => {
    const next = selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag];
    onChange?.(next);
  };

  const ensureCustom = async () => {
    const tag = query.trim();
    if (!tag || adding) return;
    if (options.includes(tag)) {
      if (!selected.includes(tag)) onChange?.([...selected, tag]);
      setQuery("");
      return;
    }
    setAdding(true);
    try {
      const resp = await fetch(`${apiBase}/api/standard-labels/ensure`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ stem_name: stemName, label: tag }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        showError?.(data.detail || "新增标签失败");
        return;
      }
      const created = await resp.json();
      const label = created?.label || tag;
      setOptions((prev) => Array.from(new Set([...prev, label])));
      if (!selected.includes(label)) onChange?.([...selected, label]);
      setQuery("");
    } catch (err) {
      showError?.("新增标签失败：" + (err?.message || "网络错误"));
    } finally {
      setAdding(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((t) => t.toLowerCase().includes(q));
  }, [query, options]);

  const trimmed = query.trim();
  const showCreate = trimmed && !options.includes(trimmed);

  const boxClass = isDark
    ? "bg-slate-900 border-slate-700 text-slate-100"
    : "bg-white border-slate-300 text-slate-800";
  const dropdownClass = isDark
    ? "bg-slate-800 border-slate-700"
    : "bg-white border-slate-200";
  const rowClass = isDark
    ? "hover:bg-slate-700/60 text-slate-200"
    : "hover:bg-slate-50 text-slate-700";
  const chipClass = isDark
    ? "bg-cyan-600/20 border-cyan-500/40 text-cyan-200"
    : "bg-cyan-50 border-cyan-300 text-cyan-800";

  return (
    <div ref={rootRef} className="relative">
      {/* 已选标签 chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border ${chipClass}`}
            >
              {tag}
              <button
                type="button"
                onClick={() => toggle(tag)}
                className="opacity-70 hover:opacity-100"
                aria-label={`移除 ${tag}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 搜索输入框 */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={`w-full rounded border px-3 py-2 pr-8 text-sm ${boxClass}`}
        />
        <ChevronDown
          size={16}
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${isDark ? "text-slate-500" : "text-slate-400"}`}
        />
      </div>

      {/* 下拉列表 */}
      {open && (
        <div
          className={`absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border shadow-lg ${dropdownClass}`}
        >
          {filtered.map((tag) => {
            const active = selected.includes(tag);
            return (
              <button
                type="button"
                key={tag}
                onClick={() => toggle(tag)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left ${rowClass}`}
              >
                <span>{tag}</span>
                {active && <Check size={14} className="text-cyan-500 flex-shrink-0" />}
              </button>
            );
          })}
          {filtered.length === 0 && !showCreate && (
            <div className={`px-3 py-2 text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              无匹配标签
            </div>
          )}
          {showCreate && (
            <button
              type="button"
              onClick={ensureCustom}
              disabled={adding}
              className={`w-full flex items-center gap-1.5 px-3 py-2 text-sm text-left border-t ${
                isDark
                  ? "border-slate-700 text-cyan-300 hover:bg-cyan-900/30"
                  : "border-slate-200 text-cyan-600 hover:bg-cyan-50"
              }`}
            >
              <Plus size={14} className="flex-shrink-0" />
              {adding ? "正在新增…" : `新增自定义「${trimmed}」`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
