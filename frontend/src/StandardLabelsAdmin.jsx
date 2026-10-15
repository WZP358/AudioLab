import React, { useState, useEffect, useMemo } from "react";
import { Plus, Edit, Trash2, Search, Save, X, CheckCircle2, RotateCcw } from "lucide-react";
import { useToast } from "./Toast";

const API_BASE = process.env.REACT_APP_API_BASE || (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");

const STEMS = ["Vocals", "Drums", "Bass", "Other"];
const STEM_LABEL = { Vocals: "人声", Drums: "鼓", Bass: "贝斯", Other: "其他" };

const emptyForm = { stem_name: "Vocals", label: "", description: "" };

export default function StandardLabelsAdmin({ token }) {
  const { showError, showSuccess } = useToast();
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStem, setFilterStem] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const fetchLabels = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/standard-labels?include_inactive=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setLabels(Array.isArray(data) ? data : []);
    } catch (err) {
      showError("加载标签失败：" + (err?.message || ""));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return labels.filter((item) => {
      if (filterStem && item.stem_name !== filterStem) return false;
      if (q && !(item.label || "").toLowerCase().includes(q) && !(item.description || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [labels, filterStem, search]);

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditForm({ stem_name: item.stem_name, label: item.label, description: item.description || "", is_active: item.is_active !== false });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm);
  };

  const saveEdit = async () => {
    if (!editForm.label.trim()) { showError("标签名称不能为空"); return; }
    try {
      const resp = await fetch(`${API_BASE}/api/standard-labels/${encodeURIComponent(String(editingId))}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(editForm),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        showError(data.detail || "更新失败");
        return;
      }
      showSuccess("标签已更新");
      cancelEdit();
      fetchLabels();
    } catch (err) {
      showError("更新失败：" + (err?.message || ""));
    }
  };

  const createLabel = async () => {
    if (!createForm.label.trim()) { showError("标签名称不能为空"); return; }
    try {
      const resp = await fetch(`${API_BASE}/api/standard-labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(createForm),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        showError(data.detail || "新增失败");
        return;
      }
      showSuccess("标签已新增");
      setCreateForm(emptyForm);
      setShowCreate(false);
      fetchLabels();
    } catch (err) {
      showError("新增失败：" + (err?.message || ""));
    }
  };

  const toggleActive = async (item) => {
    const payload = { stem_name: item.stem_name, label: item.label, description: item.description || "", is_active: item.is_active === false };
    try {
      const resp = await fetch(`${API_BASE}/api/standard-labels/${encodeURIComponent(String(item.id))}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        showError(data.detail || "切换状态失败");
        return;
      }
      fetchLabels();
    } catch (err) {
      showError("切换状态失败：" + (err?.message || ""));
    }
  };

  const deleteLabel = async (item) => {
    if (!window.confirm(`确定删除标签「${item.label}」吗？删除后不可恢复。`)) return;
    try {
      const resp = await fetch(`${API_BASE}/api/standard-labels/${encodeURIComponent(String(item.id))}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        showError(data.detail || "删除失败");
        return;
      }
      showSuccess("标签已删除");
      fetchLabels();
    } catch (err) {
      showError("删除失败：" + (err?.message || ""));
    }
  };

  const inputClass = "w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm focus:outline-none focus:border-cyan-500";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">听感问题标签管理</h3>
            <p className="text-xs text-slate-500 mt-1">维护各声源的标准化听感问题标签，供专家在盲化评分与整体评分中选择；专家自定义新增的标签也会自动出现在这里。</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition"
          >
            <Plus size={16} />
            新增标签
          </button>
        </div>

        {showCreate && (
          <div className="mb-4 rounded-lg border border-cyan-200 dark:border-cyan-900/60 bg-cyan-50/60 dark:bg-cyan-950/20 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">声源</label>
                <select value={createForm.stem_name} onChange={(e) => setCreateForm({ ...createForm, stem_name: e.target.value })} className={inputClass}>
                  {STEMS.map((s) => <option key={s} value={s}>{s}（{STEM_LABEL[s]}）</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">标签名称</label>
                <input type="text" value={createForm.label} onChange={(e) => setCreateForm({ ...createForm, label: e.target.value })} placeholder="例如：低频浑浊" className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">描述（可选）</label>
              <input type="text" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} placeholder="补充说明该问题的含义" className={inputClass} />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={createLabel} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm transition"><Save size={14} />保存</button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition">取消</button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">声源</span>
            <select value={filterStem} onChange={(e) => setFilterStem(e.target.value)} className="px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-white text-sm">
              <option value="">全部</option>
              {STEMS.map((s) => <option key={s} value={s}>{s}（{STEM_LABEL[s]}）</option>)}
            </select>
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索标签或描述…" className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-white text-sm" />
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">共 {filtered.length} 个标签</span>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">暂无标签</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs">
                  <th className="py-2 pr-3 font-medium">声源</th>
                  <th className="py-2 pr-3 font-medium">标签名称</th>
                  <th className="py-2 pr-3 font-medium">描述</th>
                  <th className="py-2 pr-3 font-medium text-center">状态</th>
                  <th className="py-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    {editingId === item.id ? (
                      <>
                        <td className="py-2 pr-3">
                          <select value={editForm.stem_name} onChange={(e) => setEditForm({ ...editForm, stem_name: e.target.value })} className={inputClass}>
                            {STEMS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="py-2 pr-3"><input type="text" value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} className={inputClass} /></td>
                        <td className="py-2 pr-3"><input type="text" value={editForm.description || ""} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className={inputClass} /></td>
                        <td className="py-2 pr-3 text-center">
                          <label className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">
                            <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} className="rounded" /> 启用
                          </label>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button type="button" onClick={saveEdit} className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20" title="保存"><Save size={16} /></button>
                          <button type="button" onClick={cancelEdit} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" title="取消"><X size={16} /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{item.stem_name}</td>
                        <td className="py-2 pr-3 font-medium text-slate-800 dark:text-white">{item.label}</td>
                        <td className="py-2 pr-3 text-slate-500 dark:text-slate-400 text-xs">{item.description || "-"}</td>
                        <td className="py-2 pr-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleActive(item)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition ${
                              item.is_active !== false
                                ? "text-emerald-500 border-emerald-300 dark:border-emerald-700"
                                : "text-slate-400 border-slate-300 dark:border-slate-600"
                            }`}
                            title="点击切换启用/停用"
                          >
                            {item.is_active !== false ? <CheckCircle2 size={12} /> : <RotateCcw size={12} />}
                            {item.is_active !== false ? "启用" : "停用"}
                          </button>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button type="button" onClick={() => startEdit(item)} className="p-1.5 rounded-lg text-cyan-500 hover:bg-cyan-50 dark:hover:bg-cyan-900/20" title="编辑"><Edit size={16} /></button>
                          <button type="button" onClick={() => deleteLabel(item)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除"><Trash2 size={16} /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
