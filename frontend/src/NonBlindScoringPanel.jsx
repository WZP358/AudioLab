import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, Send } from "lucide-react";
import IssueTagSelect from "./IssueTagSelect";

const STEM_NAMES = ["Vocals", "Drums", "Bass", "Other"];

const DIMENSIONS = [
  ["quality", "声源完整性"],
  ["interference", "非目标声源干扰抑制"],
  ["artifacts", "算法伪影控制"],
  ["overall_acceptability", "整体可接受度"],
];

const emptyStemScore = () => ({
  quality: 3,
  interference: 3,
  artifacts: 3,
  overall_acceptability: 3,
  segment_start: 0,
  segment_end: 15,
  issue_tags: [],
  issue_annotations: [],
  reliability: 3,
});

const buildEmptyForms = () =>
  Object.fromEntries(STEM_NAMES.map((name) => [name, emptyStemScore()]));

export default function NonBlindScoringPanel({
  taskId,
  algorithm,
  authToken,
  apiBase,
  showError,
  showSuccess,
  isDark,
}) {
  const [forms, setForms] = useState(buildEmptyForms);
  const [existing, setExisting] = useState(null); // null=加载中, []=未提交, [{...}]=已提交的非盲化评分
  const [submitting, setSubmitting] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // 拉取本任务已提交的非盲化评分（blind_sample_id 为空的记录），用于回填与防重复提交。
  useEffect(() => {
    let cancelled = false;
    if (!taskId || !authToken) {
      setExisting([]);
      return;
    }
    setExisting(null);
    fetch(`${apiBase}/api/scores/me?task_id=${encodeURIComponent(String(taskId))}&limit=100`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((resp) => {
        if (!resp.ok) throw new Error("加载已有评分失败");
        return resp.json();
      })
      .then((list) => {
        if (cancelled) return;
        const nonBlind = (Array.isArray(list) ? list : []).filter((s) => s.blind_sample_id == null);
        if (nonBlind.length) {
          setExisting(nonBlind);
          setForms((prev) => {
            const next = { ...prev };
            for (const s of nonBlind) {
              if (!s.stem_name || !next[s.stem_name]) continue;
              next[s.stem_name] = {
                ...next[s.stem_name],
                quality: s.quality ?? 3,
                interference: s.interference ?? 3,
                artifacts: s.artifacts ?? 3,
                overall_acceptability: s.overall_acceptability ?? 3,
                reliability: s.reliability ?? 3,
                issue_tags: Array.isArray(s.issue_tags) ? s.issue_tags : [],
              };
            }
            return next;
          });
        } else {
          setExisting([]);
        }
      })
      .catch(() => {
        if (!cancelled) setExisting([]);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, authToken, apiBase]);

  const updateStem = useCallback((stemName, patch) => {
    setForms((prev) => ({ ...prev, [stemName]: { ...prev[stemName], ...patch } }));
  }, []);

  const handleTagsChange = useCallback((stemName, nextTags) => {
    setForms((prev) => {
      const f = prev[stemName];
      return {
        ...prev,
        [stemName]: {
          ...f,
          issue_tags: nextTags,
          issue_annotations: nextTags.map((tag) => f.issue_annotations.find((a) => a.tag === tag) || { tag, start: 0, end: 15, note: "" }),
        },
      };
    });
  }, []);

  const submit = async () => {
    if (!taskId || !algorithm) {
      showError("缺少任务或算法信息，无法提交评分");
      return;
    }
    const scores = STEM_NAMES.map((name) => {
      const f = forms[name];
      return {
        stem_name: name,
        quality: f.quality,
        interference: f.interference,
        artifacts: f.artifacts,
        overall_acceptability: f.overall_acceptability,
        segment_start: f.segment_start,
        segment_end: f.segment_end,
        issue_tags: f.issue_tags,
        issue_annotations: f.issue_annotations,
        reliability: f.reliability,
      };
    });
    setSubmitting(true);
    try {
      const resp = await fetch(`${apiBase}/api/scores/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ task_id: String(taskId), algorithm, scores }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        showError(data.detail || "评分提交失败");
        if (resp.status === 409) {
          // 已存在，回到“已提交”展示，避免用户困惑
          setExisting(scores.map((s) => ({ ...s, blind_sample_id: null })));
        }
        return;
      }
      showSuccess("非盲化整体评分已提交（内部参考，不计入盲化实验统计）");
      setExisting(scores.map((s) => ({ ...s, blind_sample_id: null })));
    } catch (err) {
      showError("评分提交失败：" + (err?.message || "网络错误"));
    } finally {
      setSubmitting(false);
    }
  };

  const cardClass = isDark
    ? "bg-slate-800/50 border-slate-700/50"
    : "bg-white border-slate-200 shadow-sm";
  const inputClass = isDark
    ? "bg-slate-900 border-slate-700 text-slate-100 focus:border-cyan-500"
    : "bg-white border-slate-300 text-slate-700 focus:border-cyan-500";

  return (
    <div className={`rounded-xl border ${cardClass}`}>
      <div className="p-4 pb-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-2 text-sm font-bold uppercase text-left"
        >
          <span className="inline-flex items-center gap-1.5">
            <span className={isDark ? "text-slate-300" : "text-slate-700"}>5. 非盲化整体评分</span>
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
              内部参考
            </span>
          </span>
          {collapsed ? (
            <ChevronRight size={16} className="ml-auto" />
          ) : (
            <ChevronDown size={16} className="ml-auto" />
          )}
        </button>
        <p className={`mt-1 text-xs ${isDark ? "text-slate-500" : "text-slate-500"}`}>
          对当前任务结果进行非盲化整体评分，算法与声源可见；仅作内部参考，默认不计入盲化实验统计。
        </p>
      </div>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-4">
          {existing && existing.length > 0 ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 flex items-start gap-2">
              <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs leading-relaxed">
                <span className="font-semibold text-emerald-400">已提交非盲化评分。</span>
                <span className={isDark ? "text-slate-400" : "text-slate-600"}>
                  {" "}
                  如需修改，请先在「实验统计 → 我的评分记录」中删除对应记录，再回到此处重新提交。
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {STEM_NAMES.map((name) => {
                  const f = forms[name];
                  return (
                    <div
                      key={name}
                      className={`rounded-lg border p-3 ${isDark ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-slate-50"}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                          {name}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {DIMENSIONS.map(([key, label]) => (
                          <label key={key} className="block text-xs">
                            <span className={isDark ? "text-slate-400" : "text-slate-600"}>{label}</span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <input
                                type="range"
                                min="1"
                                max="5"
                                value={f[key]}
                                onChange={(e) => updateStem(name, { [key]: Number(e.target.value) })}
                                className="w-full accent-cyan-500"
                              />
                              <span className="w-7 text-right font-mono text-cyan-500 text-xs">{f[key]}</span>
                            </div>
                          </label>
                        ))}
                        <label className="block text-xs pt-1">
                          <span className={isDark ? "text-slate-400" : "text-slate-600"}>
                            评分可靠性：{f.reliability}
                          </span>
                          <input
                            type="range"
                            min="1"
                            max="5"
                            value={f.reliability}
                            onChange={(e) => updateStem(name, { reliability: Number(e.target.value) })}
                            className="w-full accent-cyan-500 mt-1"
                          />
                        </label>
                      </div>
                      <div className="mt-3">
                        <div className={`text-xs mb-1.5 ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                          听感问题（可多选，支持搜索与自定义）
                        </div>
                        <IssueTagSelect
                          stemName={name}
                          selected={f.issue_tags}
                          onChange={(tags) => handleTagsChange(name, tags)}
                          authToken={authToken}
                          apiBase={apiBase}
                          isDark={isDark}
                          showError={showError}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition ${
                    submitting ? "bg-slate-500 cursor-not-allowed" : "bg-cyan-600 hover:bg-cyan-500"
                  }`}
                >
                  <Send size={14} />
                  {submitting ? "提交中..." : "提交整体评分"}
                </button>
                <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                  提交后可在实验统计中查看，但默认不进入盲化实验统计与导出。
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
