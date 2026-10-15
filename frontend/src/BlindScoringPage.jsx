import React, { useState, useEffect, useRef, useCallback } from "react";
import StemPlayer from "./StemPlayer";
import IssueTagSelect from "./IssueTagSelect";

function specColor(v) {
  // 归一化 [0,1] 幅度 -> 近似 viridis 配色（深蓝 -> 青 -> 黄），用于频谱热图。
  const t = Math.max(0, Math.min(1, v));
  const r = Math.round(255 * Math.min(1, Math.max(0, 1.0 * t * 0 + 0.268)));
  const stops = [
    [0.0, [68, 1, 84]],
    [0.25, [59, 82, 139]],
    [0.5, [33, 145, 140]],
    [0.75, [94, 201, 98]],
    [1.0, [253, 231, 37]],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const span = Math.max(1e-6, hi[0] - lo[0]);
  const f = (t - lo[0]) / span;
  const r2 = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * f);
  const g2 = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * f);
  const b2 = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * f);
  return [r2, g2, b2, r];
}

function BlindVisualization({ isDark, analysis, segmentStart, segmentEnd, onRangeChange, playbackTime = 0 }) {
  const waveRef = useRef(null);
  const specRef = useRef(null);
  const [sizeTick, setSizeTick] = useState(0);

  useEffect(() => {
    const container = waveRef.current?.parentElement;
    if (!container) return;
    const applySize = () => setSizeTick((t) => t + 1);
    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const duration = analysis?.duration_s || 15;
    const rangeActive = segmentStart > 0 || segmentEnd < duration - 0.001;
    const wave = analysis?.waveform || [];
    const env = analysis?.waveform_min && analysis?.waveform_max ? { min: analysis.waveform_min, max: analysis.waveform_max } : null;
    const spectrum = analysis?.spectrogram || [];

    const drawPlayhead = (ctx, w, h, dpr) => {
      if (!Number.isFinite(playbackTime) || playbackTime <= 0) return;
      const x = (Math.max(0, Math.min(playbackTime, duration)) / duration) * w;
      if (x < 0 || x > w) return;
      ctx.save();
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(x, h - 6 * dpr, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawWave = () => {
      const canvas = waveRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor((canvas.clientWidth || canvas.width || 400) * dpr));
      const h = Math.max(1, Math.floor((canvas.clientHeight || canvas.height || 120) * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = isDark ? "#0f172a" : "#f8fafc";
      ctx.fillRect(0, 0, w, h);

      // 零轴
      ctx.strokeStyle = isDark ? "#334155" : "#e2e8f0";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      const drawRangeOverlay = () => {
        if (!rangeActive) return;
        const x1 = Math.max(0, Math.min(1, segmentStart / duration)) * w;
        const x2 = Math.max(0, Math.min(1, segmentEnd / duration)) * w;
        if (x2 > x1) {
          ctx.fillStyle = "rgba(34, 211, 238, 0.18)";
          ctx.fillRect(x1, 0, x2 - x1, h);
          ctx.strokeStyle = "#22d3ee";
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, h); ctx.stroke();
        }
      };

      // 自动增益：按当前可见波形峰值归一化，避免静音片段缩成一条细线
      let peak = 0;
      [wave, env?.min, env?.max].forEach((arr) => {
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < arr.length; i += 1) {
          const a = Math.abs(arr[i]);
          if (Number.isFinite(a) && a > peak) peak = a;
        }
      });
      const scaleY = (peak > 1e-6 ? 1 / peak : 1) * h * 0.44;

      const source = env && env.min.length ? env : null;
      if (source) {
        const n = source.min.length;
        ctx.fillStyle = isDark ? "rgba(34, 211, 238, 0.35)" : "rgba(8, 145, 178, 0.30)";
        ctx.beginPath();
        for (let i = 0; i < n; i += 1) {
          const x = (i / (n - 1)) * w;
          const vmax = Math.max(-1, Math.min(1, source.max[i] || 0));
          const yTop = h / 2 - vmax * scaleY;
          if (i === 0) ctx.moveTo(x, yTop); else ctx.lineTo(x, yTop);
        }
        for (let i = n - 1; i >= 0; i -= 1) {
          const x = (i / (n - 1)) * w;
          const vmin = Math.max(-1, Math.min(1, source.min[i] || 0));
          const yBot = h / 2 - vmin * scaleY;
          ctx.lineTo(x, yBot);
        }
        ctx.closePath();
        ctx.fill();
      }

      // 中线：叠加一条清晰的中线，让波形轮廓更锐利
      if (wave.length) {
        const n = wave.length;
        ctx.strokeStyle = isDark ? "#22d3ee" : "#0891b2";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        for (let i = 0; i < n; i += 1) {
          const x = (i / (n - 1)) * w;
          const v = Math.max(-1, Math.min(1, wave[i] || 0));
          const y = h / 2 - v * scaleY;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      drawRangeOverlay();
      drawPlayhead(ctx, w, h, dpr);
    };

    const drawSpec = () => {
      const canvas = specRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor((canvas.clientWidth || canvas.width || 400) * dpr));
      const h = Math.max(1, Math.floor((canvas.clientHeight || canvas.height || 160) * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const image = ctx.createImageData(w, h);
      const fBins = spectrum.length;
      const tBins = fBins ? (spectrum[0]?.length || 0) : 0;
      for (let y = 0; y < h; y += 1) {
        const f = Math.floor(((h - 1 - y) / h) * fBins);
        const row = spectrum[f] || [];
        for (let x = 0; x < w; x += 1) {
          const t = Math.floor((x / w) * (tBins - 1));
          const v = Math.max(0, Math.min(1, row[t] ?? 0));
          const [r, g, b] = specColor(v);
          const idx = (y * w + x) * 4;
          image.data[idx] = r; image.data[idx + 1] = g; image.data[idx + 2] = b; image.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      // 选中区间高亮 + 边界
      const x1 = Math.max(0, Math.min(1, segmentStart / duration)) * w;
      const x2 = Math.max(0, Math.min(1, segmentEnd / duration)) * w;
      if (rangeActive && x2 > x1) {
        ctx.fillStyle = "rgba(34, 211, 238, 0.12)";
        ctx.fillRect(x1, 0, x2 - x1, h);
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, h); ctx.stroke();
      }
      drawPlayhead(ctx, w, h, dpr);
    };

    drawWave();
    drawSpec();
  }, [analysis, segmentStart, segmentEnd, isDark, sizeTick, playbackTime]);

  useEffect(() => { draw(); }, [draw]);

  const handlePointer = (event) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (event.clientX - rect.left) / (rect.width || 1)));
    const duration = analysis?.duration_s || 15;
    const time = Math.round(frac * duration * 10) / 10;
    if (event.shiftKey) {
      onRangeChange(Math.min(segmentStart, time), Math.max(segmentStart, time));
    } else {
      onRangeChange(time, Math.min(duration, time + 5));
    }
  };

  if (!analysis || (!analysis.waveform?.length && !analysis.spectrogram?.length)) {
    return <div className={`rounded-lg border p-4 text-center text-xs ${isDark ? "border-slate-700 bg-slate-800/40 text-slate-400" : "border-slate-200 bg-white text-slate-500"}`}>可视化加载中…</div>;
  }

  return <div className="space-y-2">
    <div>
      <div className="text-xs mb-1 flex items-center justify-between"><span className="text-slate-500">波形（点击设问题开始，Shift+点击设问题结束）</span><span className="font-mono text-cyan-500">{Number(segmentStart).toFixed(1)}s – {Number(segmentEnd).toFixed(1)}s</span></div>
      <canvas ref={waveRef} onClick={handlePointer} className="block w-full h-28 cursor-crosshair rounded border" style={{ borderColor: isDark ? "#334155" : "#e2e8f0" }} />
    </div>
    <div>
      <div className="text-xs mb-1 text-slate-500">频谱（低频在下，高频在上）</div>
      <canvas ref={specRef} onClick={handlePointer} className="block w-full h-40 cursor-crosshair rounded border" style={{ borderColor: isDark ? "#334155" : "#e2e8f0" }} />
    </div>
  </div>;
}

function BlindScoringPage({ isDark, authToken, apiBase, showError, showSuccess }) {
  const [selectedCode, setSelectedCode] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [form, setForm] = useState({ quality: 3, interference: 3, artifacts: 3, overall_acceptability: 3, segment_start: 0, segment_end: 15, issue_tags: [], issue_annotations: [], reliability: 3 });
  const [blindSamples, setBlindSamples] = useState([]);

  useEffect(() => {
    if (!authToken) return;
    fetch(`${apiBase}/api/blind-samples`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((resp) => (resp.ok ? resp.json() : []))
      .then((items) => { const available = Array.isArray(items) ? items.filter((sample) => !sample.scored) : []; setBlindSamples(available); })
      .catch(() => {});
  }, [apiBase, authToken]);

  const sample = blindSamples.find((item) => item.blind_code === selectedCode) || blindSamples[0];
  const stemName = sample?.stem_name || "Other";
  const inputClass = `rounded border ${isDark ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-slate-300 text-slate-800"}`;

  useEffect(() => {
    if (!sample?.blind_code) return;
    setSelectedCode(sample.blind_code);
  }, [sample?.blind_code]);

  useEffect(() => {
    let objectUrl = "";
    if (!selectedCode || !authToken) return undefined;
    fetch(`${apiBase}/api/blind-samples/${encodeURIComponent(selectedCode)}/audio`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => { if (!response.ok) throw new Error("音频加载失败"); return response.blob(); })
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setAudioUrl(objectUrl); })
      .catch(() => setAudioUrl(""));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [apiBase, authToken, selectedCode]);

  useEffect(() => {
    if (!selectedCode || !authToken) { setAnalysis(null); return undefined; }
    let cancelled = false;
    fetch(`${apiBase}/api/blind-samples/${encodeURIComponent(selectedCode)}/analysis`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => { if (!response.ok) throw new Error("可视化加载失败"); return response.json(); })
      .then((data) => { if (!cancelled) setAnalysis(data); })
      .catch(() => { if (!cancelled) setAnalysis(null); });
    return () => { cancelled = true; };
  }, [apiBase, authToken, selectedCode]);

  useEffect(() => {
    setLoopEnabled(false);
    setPlaybackTime(0);
    setForm({ quality: 3, interference: 3, artifacts: 3, overall_acceptability: 3, segment_start: 0, segment_end: 15, issue_tags: [], issue_annotations: [], reliability: 3 });
  }, [selectedCode]);

  const updateForm = (patch) => setForm((previous) => ({ ...previous, ...patch }));
  const setTimeRange = (key, value) => {
    const numeric = Math.max(0, Math.min(15, Number(value)));
    updateForm({ [key]: numeric });
  };
  const toggleTag = (tag) => {
    const active = form.issue_tags.includes(tag);
    updateForm({
      issue_tags: active ? form.issue_tags.filter((item) => item !== tag) : [...form.issue_tags, tag],
      issue_annotations: active ? form.issue_annotations.filter((item) => item.tag !== tag) : [...form.issue_annotations, { tag, start: form.segment_start, end: form.segment_end, note: "" }],
    });
  };
  const handleTagsChange = (nextTags) => {
    setForm((prev) => ({
      ...prev,
      issue_tags: nextTags,
      issue_annotations: nextTags.map((tag) => prev.issue_annotations.find((item) => item.tag === tag) || { tag, start: prev.segment_start, end: prev.segment_end, note: "" }),
    }));
  };
  const updateAnnotation = (index, patch) => updateForm({ issue_annotations: form.issue_annotations.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const submit = async () => {
    if (!sample?.blind_code) return;
    if (form.segment_start >= form.segment_end) { showError("问题开始时间必须早于结束时间"); return; }
    const response = await fetch(`${apiBase}/api/blind-samples/score`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ blind_code: sample.blind_code, ...form }) });
    if (!response.ok) { showError(`盲化评分未保存：${await response.text()}`); return; }
    setBlindSamples((items) => items.filter((item) => item.blind_code !== sample.blind_code));
    showSuccess("盲化评分已提交");
  };

  return <main className={`min-h-screen pt-24 pb-10 px-4 ${isDark ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-800"}`}>
    <div className="max-w-4xl mx-auto">
      <div className="mb-5"><div className="text-xs uppercase tracking-widest text-cyan-500">Blind evaluation</div><h1 className="text-2xl font-bold mt-1">盲化专家评分</h1><p className="text-sm mt-2 text-slate-500">只显示盲化编号和目标声源，不显示算法、任务编号或原始文件名。</p><p className="text-xs mt-2 text-slate-400">盲化样本来自全局共享评分池：由管理员从已完成的分离任务生成，所有专家均可评分，与你自己是否运行过分离任务无关。</p></div>
      {!sample ? <div className={`rounded-xl border p-8 text-center ${isDark ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-white"}`}>暂无待评分的 15 秒盲化样本</div> : <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        <section className={`rounded-xl border p-5 ${isDark ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-white"}`}>
          <label className="block text-sm font-semibold">盲化样本<select value={sample.blind_code} onChange={(event) => setSelectedCode(event.target.value)} className={`mt-2 w-full rounded border px-3 py-2 ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-300"}`}>{blindSamples.map((item) => <option key={item.blind_code} value={item.blind_code}>{item.blind_code}</option>)}</select></label>
          <div className="mt-5 flex items-center justify-between"><span className="text-sm text-slate-500">目标声源</span><strong>{stemName}</strong></div>
          <div className="mt-4"><BlindVisualization isDark={isDark} analysis={analysis} segmentStart={form.segment_start} segmentEnd={form.segment_end} onRangeChange={(start, end) => updateForm({ segment_start: Math.max(0, Math.min(15, start)), segment_end: Math.max(0, Math.min(15, end)) })} playbackTime={playbackTime} /></div>
          {audioUrl && <StemPlayer name="盲化样本" src={audioUrl} showDownload={false} loopStart={form.segment_start} loopEnd={form.segment_end} loopEnabled={loopEnabled} onLoopToggle={() => setLoopEnabled((value) => !value)} onPlaybackStateChange={(state) => { if (state && Number.isFinite(state.currentTime)) setPlaybackTime(state.currentTime); }} />}
          <p className="text-xs text-slate-500 mt-3">设置问题时间范围后点击播放器的循环按钮，可反复试听该区间。</p>
        </section>
        <section className={`rounded-xl border p-5 ${isDark ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-white"}`}>
          <div className="grid grid-cols-2 gap-3">{[["quality","声源完整性"],["interference","非目标声源干扰抑制"],["artifacts","算法伪影控制"],["overall_acceptability","整体可接受度"]].map(([key,label]) => <label key={key} className="text-sm">{label}<div className="flex items-center gap-2 mt-1"><input type="range" min="1" max="5" value={form[key]} onChange={(event) => updateForm({ [key]: Number(event.target.value) })} className="w-full accent-cyan-500" /><span className="w-8 text-right font-mono text-cyan-500">{form[key]} / 5</span></div></label>)}</div>
          <div className="grid grid-cols-2 gap-3 mt-5"><label className="text-xs">问题开始（秒）<input type="number" min="0" max="15" step="0.1" value={form.segment_start} onChange={(event) => setTimeRange("segment_start", event.target.value)} className={`mt-1 w-full rounded border px-2 py-2 ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-300"}`} /></label><label className="text-xs">问题结束（秒）<input type="number" min="0" max="15" step="0.1" value={form.segment_end} onChange={(event) => setTimeRange("segment_end", event.target.value)} className={`mt-1 w-full rounded border px-2 py-2 ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-300"}`} /></label></div>
          <div className="mt-5"><div className="text-xs mb-2">标准化听感问题（可多选，支持搜索与自定义）</div><IssueTagSelect stemName={stemName} selected={form.issue_tags} onChange={handleTagsChange} authToken={authToken} apiBase={apiBase} isDark={isDark} showError={showError} /></div>
          {form.issue_annotations.length > 0 && <div className="mt-4 space-y-2">{form.issue_annotations.map((item,index) => <div key={`${item.tag}-${index}`} className={`rounded border p-2 ${isDark ? "border-slate-700 bg-slate-900/50" : "border-slate-200 bg-slate-50"}`}><div className="flex justify-between text-xs font-semibold"><span>{item.tag}</span><button type="button" onClick={() => toggleTag(item.tag)} className="text-red-500">删除</button></div><div className="grid grid-cols-2 gap-2 mt-2"><input type="number" min="0" max="15" step="0.1" value={item.start} onChange={(event) => updateAnnotation(index, { start: Number(event.target.value) })} className={`${inputClass} px-2 py-1 text-xs`} /><input type="number" min="0" max="15" step="0.1" value={item.end} onChange={(event) => updateAnnotation(index, { end: Number(event.target.value) })} className={`${inputClass} px-2 py-1 text-xs`} /></div><input value={item.note || ""} onChange={(event) => updateAnnotation(index, { note: event.target.value })} placeholder="备注（可选）" className={`mt-2 w-full ${inputClass} px-2 py-1 text-xs`} /></div>)}</div>}
          <label className="block text-sm mt-5">主观评分可靠性：{form.reliability} / 5<input type="range" min="1" max="5" value={form.reliability} onChange={(event) => updateForm({ reliability: Number(event.target.value) })} className="mt-2 w-full accent-cyan-500" /></label>
          <button type="button" onClick={submit} className="w-full mt-6 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold py-3">提交盲化评分</button>
        </section>
      </div>}
    </div>
  </main>;
}

export default BlindScoringPage;
