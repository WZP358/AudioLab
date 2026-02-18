import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import CustomPlayer from "./CustomPlayer";
import StemPlayer from "./StemPlayer";
import AuthPage from "./AuthPage";
import AudioResources from "./AudioResources";
import AudioResourceSelector from "./AudioResourceSelector";
import AdminDashboard from "./AdminDashboard";
import NotificationCenter from "./NotificationCenter";
import { useToast } from "./Toast";
// --- Firestore (temporarily disabled; kept for easy restore) ---
// import {
//   getFirestore,
//   collection,
//   addDoc,
//   query,
//   onSnapshot,
//   orderBy,
//   serverTimestamp,
//   doc,
//   setDoc,
// } from "firebase/firestore";
import {
  Activity,
  Layers,
  Upload,
  ZoomIn,
  ZoomOut,
  BarChart2,
  Award,
  Music,
  CheckCircle,
  AlertTriangle,
  User,
  LogOut,
  ChevronRight,
  ChevronDown,
  Headphones,
  MessageCircle,
  Bell,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  BarChart,
  Bar,
} from "recharts";

// --- App ID for LocalStorage ---
const appId = "default-audio-lab";

// --- Simple shareable routes (no full <Routes> needed; we sync view <-> path) ---
const VIEW_TO_PATH = {
  dashboard: "/",
  stats: "/stats",
  audio_resources: "/audio-resources",
  comments: "/comments",
};
const normalizePathname = (pathname) => {
  if (typeof pathname !== "string") return "/";
  // 确保路径是安全的相对路径
  if (pathname.startsWith("http://") || pathname.startsWith("https://") || 
      // eslint-disable-next-line no-script-url
      pathname.startsWith("javascript:") || pathname.startsWith("data:")) {
    return "/";
  }
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
};
const PATH_TO_VIEW = Object.fromEntries(
  Object.entries(VIEW_TO_PATH).map(([view, path]) => [path, view]),
);

// --- LocalStorage Score Store (temporary replacement for Firestore) ---
const LS_SCORES_KEY = `audiolab:${appId}:scores`;
const readLocalScores = () => {
  try {
    const raw = localStorage.getItem(LS_SCORES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const writeLocalScores = (scores) => {
  try {
    localStorage.setItem(LS_SCORES_KEY, JSON.stringify(scores));
  } catch {
    // ignore quota / privacy errors
  }
};

// --- Storage mode toggle (UI-only for now; Firestore not configured) ---
// Note: Storage mode functions are kept for future use but currently unused

// --- Simulation Data Helpers ---
// 模拟音频数据生成器 (用于可视化)
const generateWaveformData = (points, complexity = 1) => {
  return Array.from({ length: points }, (_, i) => {
    const x = i / 10;
    return (
      Math.sin(x) * 0.5 +
      Math.sin(x * 2.5) * 0.3 * complexity +
      (Math.random() - 0.5) * 0.1
    );
  });
};

const generateSpectrumData = (width, height) => {
  // 简单的热力图模拟数据
  const data = [];
  for (let i = 0; i < width; i += 5) {
    const col = [];
    for (let j = 0; j < height; j += 5) {
      col.push(Math.random());
    }
    data.push(col);
  }
  return data;
};

// 从用户上传的"金标准"单源音频中提取波形（用于可视化对比）
const decodeFileToWaveform = async (file, points = 800) => {
  if (!file) return [];
  try {
    const AudioCtx =
      typeof window !== "undefined" &&
      (window.AudioContext || window.webkitAudioContext);
    if (!AudioCtx) {
      throw new Error("当前浏览器不支持 Web Audio API");
    }

    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new AudioCtx();
    let audioBuffer;

    // 部分浏览器的 decodeAudioData 仍然使用回调形式，这里做个兼容
    if (audioCtx.decodeAudioData.length === 1) {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } else {
      audioBuffer = await new Promise((resolve, reject) => {
        audioCtx.decodeAudioData(arrayBuffer, resolve, reject);
      });
    }

    const channelData = audioBuffer.getChannelData(0); // 只取第一个声道
    const totalSamples = channelData.length;
    const bucketSize = Math.max(1, Math.floor(totalSamples / points));

    const waveform = [];
    for (let i = 0; i < points; i += 1) {
      const start = i * bucketSize;
      if (start >= totalSamples) break;
      let sum = 0;
      let count = 0;
      for (let j = 0; j < bucketSize && start + j < totalSamples; j++) {
        sum += channelData[start + j];
        count += 1;
      }
      waveform.push(count ? sum / count : 0);
    }

    // 及时释放 AudioContext，避免过多实例
    audioCtx.close();
    return waveform.length ? waveform : generateWaveformData(points, 1);
  } catch (e) {
    console.warn("解析金标准音频失败，将退回示例波形：", e);
    return generateWaveformData(points, 1);
  }
};

// --- Components ---

// 1. 用户面板组件（仅用于普通用户界面，管理员不会看到）
const AuthPanel = ({ user, onLogout }) => {
  if (!user) return null;

  const getRoleBadge = (role) => {
    const badges = {
      expert: { color: "bg-purple-500/20 text-purple-300", label: "专家" },
      guest: { color: "bg-gray-500/20 text-gray-300", label: "访客" },
    };
    return badges[role] || badges.guest;
  };

  const badge = getRoleBadge(user.role);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-3 bg-slate-800 p-2 rounded-lg border border-slate-700">
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt={user.username}
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white text-xs">
            {user.username.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="text-sm">
          <div className="flex items-center gap-2">
            <p className="text-slate-300 font-medium">{user.username}</p>
            <span className={`px-2 py-0.5 text-xs rounded ${badge.color}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-emerald-400 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            在线
          </p>
        </div>
        <button
          onClick={onLogout}
          className="ml-2 p-2 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition"
          title="登出"
        >
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
};

// 2. 波形/频谱可视化组件 (核心难点实现)
const WaveformComparator = ({
  groundTruth,
  goldWave,
  separated,
  showMixture = true,
  showGold = true,
  showSeparated = true,
  viewRange,
  onViewRangeChange,
  playbackState = { currentTime: 0, duration: 0, playing: false, seek: null },
}) => {
  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(null); // 0~1 归一化
  const [dragCurrentX, setDragCurrentX] = useState(null); // 0~1 归一化
  const [scrubbing, setScrubbing] = useState(false); // 是否正在拖动播放进度线
  const [scrubPosition, setScrubPosition] = useState(null); // 拖动时的临时位置

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    // 清空
    ctx.clearRect(0, 0, width, height);

    // 背景网格
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < width; x += 50) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();

    const centerY = height / 2;
    const scaleY = height / 2.2;
    const vrStart = Math.max(0, Math.min(1, viewRange?.start ?? 0));
    const vrEnd = Math.max(vrStart, Math.min(1, viewRange?.end ?? 1));
    const span = Math.max(0.0001, vrEnd - vrStart);

    const mixture = Array.isArray(groundTruth) ? groundTruth : [];
    const sep = Array.isArray(separated) ? separated : [];
    const gold = Array.isArray(goldWave) ? goldWave : [];

    // 绘制混合音（Mixture / Ground）——绿色半透明
    if (showMixture && mixture.length) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(16, 185, 129, 0.6)"; // Emerald
      ctx.lineWidth = 2;
      for (let i = 0; i < width; i += 1) {
        const pos = vrStart + (i / width) * span; // 0~1
        const dataIndex = Math.floor(pos * (mixture.length - 1));
        const val = mixture[dataIndex] || 0;
        if (i === 0) ctx.moveTo(i, centerY + val * scaleY);
        else ctx.lineTo(i, centerY + val * scaleY);
      }
      ctx.stroke();
    }

    // 绘制金标准单源（Gold）——紫色半透明
    if (showGold && gold.length) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(168, 85, 247, 0.7)"; // Purple
      ctx.lineWidth = 2;
      for (let i = 0; i < width; i += 1) {
        const pos = vrStart + (i / width) * span;
        const dataIndex = Math.floor(pos * (gold.length - 1));
        const val = gold[dataIndex] || 0;
        if (i === 0) ctx.moveTo(i, centerY + val * scaleY);
        else ctx.lineTo(i, centerY + val * scaleY);
      }
      ctx.stroke();
    }

    // 绘制 Separated (蓝色半透明)
    if (showSeparated && sep.length) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(6, 182, 212, 0.8)"; // Cyan
      ctx.lineWidth = 2;
      for (let i = 0; i < width; i += 1) {
        const pos = vrStart + (i / width) * span;
        const dataIndex = Math.floor(pos * (sep.length - 1));
        const val = sep[dataIndex] || 0;
        if (i === 0) ctx.moveTo(i, centerY + val * scaleY);
        else ctx.lineTo(i, centerY + val * scaleY);
      }
      ctx.stroke();
    }

    // 绘制差异高亮 (红色区域)
    ctx.fillStyle = "rgba(239, 68, 68, 0.3)"; // Red
    ctx.beginPath();
    for (let i = 0; i < width; i += 1) {
      const pos = vrStart + (i / width) * span;
      const dataIndex = Math.floor(pos * (groundTruth.length - 1));
      const gt = groundTruth[dataIndex] || 0;
      const sep = separated[dataIndex] || 0;
      const diff = Math.abs(gt - sep);

      // 只有当差异足够大时才绘制
      if (diff > 0.15) {
        const y1 = centerY + gt * scaleY;
        const y2 = centerY + sep * scaleY;
        ctx.fillRect(i, Math.min(y1, y2), 1, Math.abs(y1 - y2));
      }
    }

    // 绘制播放进度竖线
    if (playbackState?.duration > 0) {
      const currentPos = scrubbing && scrubPosition !== null
        ? scrubPosition
        : playbackState.currentTime / playbackState.duration; // 0~1
      
      // 将全局位置转换为视窗内的位置
      const posInView = (currentPos - vrStart) / span;
      
      if (posInView >= 0 && posInView <= 1) {
        const x = posInView * width;
        ctx.strokeStyle = "#fbbf24"; // 黄色竖线
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        
        // 添加一个小圆点
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(x, height - 8, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [groundTruth, goldWave, separated, showMixture, showGold, showSeparated, viewRange, playbackState, scrubbing, scrubPosition]);

  const getNormalizedX = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  };

  // 检查点击位置是否在进度线附近（用于拖动进度线）
  const isNearProgressLine = (normalizedX) => {
    if (!playbackState?.duration || playbackState.duration <= 0) return false;
    
    const currentPos = scrubbing && scrubPosition !== null
      ? scrubPosition
      : playbackState.currentTime / playbackState.duration;
    
    const vrStart = Math.max(0, Math.min(1, viewRange?.start ?? 0));
    const vrEnd = Math.max(vrStart, Math.min(1, viewRange?.end ?? 1));
    const span = Math.max(0.0001, vrEnd - vrStart);
    const posInView = (currentPos - vrStart) / span;
    
    if (posInView < 0 || posInView > 1) return false;
    
    const threshold = 0.015; // 1.5% 的容差
    return Math.abs(normalizedX - posInView) < threshold;
  };

  const handleMouseDown = (e) => {
    if (!groundTruth?.length) return;
    const nx = getNormalizedX(e);
    const isCtrlPressed = e.ctrlKey || e.metaKey; // 支持 Mac 的 Cmd 键
    
    // 如果点击在进度线附近，无论是否按 Ctrl，都执行播放跳转
    if (isNearProgressLine(nx) && playbackState?.seek) {
      setScrubbing(true);
      setScrubPosition(nx);
      // 计算实际时间位置并跳转
      const vrStart = Math.max(0, Math.min(1, viewRange?.start ?? 0));
      const vrEnd = Math.max(vrStart, Math.min(1, viewRange?.end ?? 1));
      const span = Math.max(0.0001, vrEnd - vrStart);
      const globalPos = vrStart + nx * span;
      const time = globalPos * playbackState.duration;
      playbackState.seek(time);
      return;
    }
    
    // 如果按下了 Ctrl/Cmd，执行缩放操作
    if (isCtrlPressed) {
      setDragging(true);
      setDragStartX(nx);
      setDragCurrentX(nx);
      return;
    }
    
    // 如果没有按 Ctrl 且有音频播放，执行播放跳转
    if (playbackState?.seek && playbackState?.duration && playbackState.duration > 0) {
      const vrStart = Math.max(0, Math.min(1, viewRange?.start ?? 0));
      const vrEnd = Math.max(vrStart, Math.min(1, viewRange?.end ?? 1));
      const span = Math.max(0.0001, vrEnd - vrStart);
      const globalPos = vrStart + nx * span;
      const time = globalPos * playbackState.duration;
      playbackState.seek(time);
      setScrubbing(true);
      setScrubPosition(nx);
      return;
    }
    
    // 如果没有音频播放，默认执行缩放操作（保持向后兼容）
    setDragging(true);
    setDragStartX(nx);
    setDragCurrentX(nx);
  };

  const handleMouseMove = (e) => {
    // 拖动进度线时，实时更新播放位置
    if (scrubbing) {
      const nx = getNormalizedX(e);
      setScrubPosition(nx);
      // 实时更新播放位置
      if (playbackState?.seek && playbackState?.duration) {
        const vrStart = Math.max(0, Math.min(1, viewRange?.start ?? 0));
        const vrEnd = Math.max(vrStart, Math.min(1, viewRange?.end ?? 1));
        const span = Math.max(0.0001, vrEnd - vrStart);
        const globalPos = vrStart + nx * span;
        const time = Math.max(0, Math.min(globalPos * playbackState.duration, playbackState.duration));
        playbackState.seek(time);
      }
      return;
    }
    
    // 拖动缩放区域时，更新选择区域
    if (!dragging) return;
    const nx = getNormalizedX(e);
    setDragCurrentX(nx);
  };

  const finalizeZoom = (startNorm, endNorm) => {
    if (!onViewRangeChange) return;
    const s = Math.min(startNorm, endNorm);
    const e = Math.max(startNorm, endNorm);
    // 选区太小则忽略
    if (e - s < 0.01) return;
    const baseStart = viewRange?.start ?? 0;
    const baseEnd = viewRange?.end ?? 1;
    const baseSpan = Math.max(0.0001, baseEnd - baseStart);
    const newStart = baseStart + s * baseSpan;
    const newEnd = baseStart + e * baseSpan;
    onViewRangeChange({
      start: Math.max(0, Math.min(1, newStart)),
      end: Math.max(0, Math.min(1, newEnd)),
    });
  };

  const handleMouseUp = (e) => {
    if (scrubbing) {
      setScrubbing(false);
      setScrubPosition(null);
      return;
    }
    
    if (!dragging) return;
    const nx = getNormalizedX(e);
    const start = dragStartX ?? nx;
    const end = nx;
    setDragging(false);
    setDragStartX(null);
    setDragCurrentX(null);
    finalizeZoom(start, end);
  };

  const handleDoubleClick = () => {
    // 双击重置为全局视图
    if (onViewRangeChange) {
      onViewRangeChange({ start: 0, end: 1 });
    }
  };

  const handleMouseLeave = (e) => {
    if (scrubbing) {
      setScrubbing(false);
      setScrubPosition(null);
    }
    if (dragging) {
      handleMouseUp(e);
    }
  };

  return (
    <div
      className="relative w-full h-64 bg-slate-950 rounded-lg overflow-hidden border border-slate-700 shadow-inner"
      style={{ cursor: scrubbing ? 'grabbing' : dragging ? 'crosshair' : 'pointer' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
    >
      <canvas
        ref={canvasRef}
        width={800}
        height={256}
        className="w-full h-full object-cover"
      />
      {/* 选中区域可视化 */}
      {dragging && dragStartX !== null && dragCurrentX !== null && (
        <div
          className="absolute top-0 bottom-0 bg-cyan-500/20 border-x border-cyan-400/60 pointer-events-none"
          style={{
            left: `${Math.min(dragStartX, dragCurrentX) * 100}%`,
            width: `${Math.abs(dragCurrentX - dragStartX) * 100}%`,
          }}
        />
      )}
    </div>
  );
};

const SpectrumComparator = ({
  isActive,
  originalSpectrumData,
  separatedSpectrumData,
  viewRange,
  onViewRangeChange,
}) => {
  const originalCanvasRef = useRef(null);
  const separatedCanvasRef = useRef(null);

  const drawSpectrogram = useCallback((canvas, data) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    // fallback
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#020617"; // slate-950
    ctx.fillRect(0, 0, w, h);

    if (!Array.isArray(data) || data.length === 0) return;
    const fBins = data.length;
    const tBins = Array.isArray(data[0]) ? data[0].length : 0;
    if (!tBins) return;

    const vrStart = Math.max(0, Math.min(1, viewRange?.start ?? 0));
    const vrEnd = Math.max(vrStart, Math.min(1, viewRange?.end ?? 1));
    const span = Math.max(0.0001, vrEnd - vrStart);

    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y += 1) {
      // canvas y=0 at top; spectrogram usually low->high bottom-up
      const f = Math.floor(((h - 1 - y) / h) * fBins);
      const row = data[f] || [];
      for (let x = 0; x < w; x += 1) {
        const pos = vrStart + (x / w) * span; // 0~1
        const t = Math.floor(pos * (tBins - 1));
        const vRaw = row[t] ?? 0;
        const v = Math.max(0, Math.min(1, vRaw));

        // simple "inferno-ish" gradient (no deps)
        const r = Math.floor(255 * Math.min(1, v * 1.4));
        const g = Math.floor(255 * Math.min(1, Math.max(0, (v - 0.25) * 1.3)));
        const b = Math.floor(255 * Math.max(0, 1 - v * 1.2));

        const idx = (y * w + x) * 4;
        image.data[idx + 0] = r;
        image.data[idx + 1] = g;
        image.data[idx + 2] = b;
        image.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [viewRange]);

  useEffect(() => {
    if (!isActive) return;
    drawSpectrogram(originalCanvasRef.current, originalSpectrumData);
  }, [isActive, originalSpectrumData, viewRange, drawSpectrogram]);

  useEffect(() => {
    if (!isActive) return;
    drawSpectrogram(separatedCanvasRef.current, separatedSpectrumData);
  }, [isActive, separatedSpectrumData, viewRange, drawSpectrogram]);

  const [dragging, setDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(null);
  const [dragCurrentX, setDragCurrentX] = useState(null);

  const getNormalizedX = (event, canvasRefLocal) => {
    const canvas = canvasRefLocal.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  };

  const finalizeZoom = (startNorm, endNorm) => {
    if (!onViewRangeChange) return;
    const s = Math.min(startNorm, endNorm);
    const e = Math.max(startNorm, endNorm);
    if (e - s < 0.01) return;
    const baseStart = viewRange?.start ?? 0;
    const baseEnd = viewRange?.end ?? 1;
    const baseSpan = Math.max(0.0001, baseEnd - baseStart);
    const newStart = baseStart + s * baseSpan;
    const newEnd = baseStart + e * baseSpan;
    onViewRangeChange({
      start: Math.max(0, Math.min(1, newStart)),
      end: Math.max(0, Math.min(1, newEnd)),
    });
  };

  const handleMouseDown = (e, ref) => {
    if (!isActive) return;
    const nx = getNormalizedX(e, ref);
    setDragging(true);
    setDragStartX(nx);
    setDragCurrentX(nx);
  };

  const handleMouseMove = (e, ref) => {
    if (!dragging) return;
    const nx = getNormalizedX(e, ref);
    setDragCurrentX(nx);
  };

  const handleMouseUp = (e, ref) => {
    if (!dragging) return;
    const nx = getNormalizedX(e, ref);
    const start = dragStartX ?? nx;
    const end = nx;
    setDragging(false);
    setDragStartX(null);
    setDragCurrentX(null);
    finalizeZoom(start, end);
  };

  const handleDoubleClick = () => {
    if (onViewRangeChange) {
      onViewRangeChange({ start: 0, end: 1 });
    }
  };

  if (!isActive)
    return (
      <div className="h-40 flex items-center justify-center text-slate-500">
        选择算法查看频谱
      </div>
    );

  return (
    <div className="grid grid-cols-2 gap-2 h-40">
      {/* 左侧：原始频谱 */}
      <div
        className="bg-slate-950 rounded border border-slate-700 p-1 relative overflow-hidden group"
        onMouseDown={(e) => handleMouseDown(e, originalCanvasRef)}
        onMouseMove={(e) => handleMouseMove(e, originalCanvasRef)}
        onMouseUp={(e) => handleMouseUp(e, originalCanvasRef)}
        onMouseLeave={(e) => handleMouseUp(e, originalCanvasRef)}
        onDoubleClick={handleDoubleClick}
      >
        <canvas
          ref={originalCanvasRef}
          width={256}
          height={160}
          className="w-full h-full object-cover"
        />
        <div className="absolute top-1 left-2 text-xs text-emerald-400 font-mono bg-black/50 px-1 rounded">
          Original
        </div>
      </div>

      {/* 右侧：分离后频谱 */}
      <div
        className="bg-slate-950 rounded border border-slate-700 p-1 relative overflow-hidden group"
        onMouseDown={(e) => handleMouseDown(e, separatedCanvasRef)}
        onMouseMove={(e) => handleMouseMove(e, separatedCanvasRef)}
        onMouseUp={(e) => handleMouseUp(e, separatedCanvasRef)}
        onMouseLeave={(e) => handleMouseUp(e, separatedCanvasRef)}
        onDoubleClick={handleDoubleClick}
      >
        <canvas
          ref={separatedCanvasRef}
          width={256}
          height={160}
          className="w-full h-full object-cover"
        />
        <div className="absolute top-1 left-2 text-xs text-cyan-400 font-mono bg-black/50 px-1 rounded">
          Separated
        </div>
        <div className="absolute bottom-2 right-2 text-xs text-red-400 font-mono bg-black/80 px-1 rounded border border-red-900/50">
          High Freq Loss
        </div>
      </div>
      {/* 选中区域可视化（覆盖整个组件宽度，便于感知当前缩放动作） */}
      {dragging && dragStartX !== null && dragCurrentX !== null && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{ gridColumn: "1 / span 2" }}
        >
          <div
            className="absolute top-0 bottom-0 bg-cyan-500/16 border-x border-cyan-400/50"
            style={{
              left: `${Math.min(dragStartX, dragCurrentX) * 100}%`,
              width: `${Math.abs(dragCurrentX - dragStartX) * 100}%`,
            }}
          />
        </div>
      )}
    </div>
  );
};

// --- Main Application ---
// 与后端 app.models.Algorithm 保持一致的可选算法列表
const ALGORITHMS = [
  "MDX23C",
  "Demucs4HT",
  "Band Split RoFormer",
  "SCNet",
];
const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export default function AudioLabApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const fileInputRef = useRef(null); // 控制隐藏的 input
  const [audioUrl, setAudioUrl] = useState(null); // 存放本地播放地址
  const [user, setUser] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [currentView, setCurrentView] = useState("dashboard"); // dashboard, evaluate, stats, audio_resources
  const [file, setFile] = useState(null);
  const [rawFile, setRawFile] = useState(null); // 保存真实 File，用于上传到后端
  const [stems, setStems] = useState([]);
  const [currentStem, setCurrentStem] = useState(null); // 当前选中的单声源（用于与金标准对比）
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedAlgo, setSelectedAlgo] = useState(null);
  const [results, setResults] = useState(null);
  const [taskId, setTaskId] = useState(null);
  const [progressText, setProgressText] = useState(""); // 进度文本
  // 可视化的时间视窗 [0,1]，0 和 1 分别代表整段音频的起止
  const [viewRange, setViewRange] = useState({ start: 0, end: 1 });
  // 按 stem 维度存储主观评分：stemName -> { quality, interference, artifacts }
  const [stemScores, setStemScores] = useState({});

  // ---- 播放进度统一同步（Input / Gold / Stem 共用一条“全局时间轴”）----
  const inputPlaybackRef = useRef(null);
  const goldPlaybackRef = useRef(null);
  const stemPlaybackRef = useRef(null);
  const activePlayerKeyRef = useRef(null); // 'input' | 'gold' | 'stem' | null

  const [syncedCurrentTime, setSyncedCurrentTime] = useState(0);
  const [syncedDuration, setSyncedDuration] = useState(0);
  const [syncedPlaying, setSyncedPlaying] = useState(false);
  
  // 保存三个播放器的引用，用于互斥播放
  const inputSourceAudioRef = useRef(null);
  const goldStandardAudioRef = useRef(null);
  const separatedStemAudioRef = useRef(null);
  const previousPlayingState = useRef({ input: false, gold: false, separated: false });

  // Realtime stats from Firestore
  const [communityStats, setCommunityStats] = useState([]);
  const [storageMode, setStorageMode] = useState("local");
  // 后端统计数据
  const [backendStats, setBackendStats] = useState([]);
  const [algorithmComparison, setAlgorithmComparison] = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);
  
  // 通知相关状态
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  // 波形/频谱：默认先用 mock，占位；任务完成后用后端分析结果覆盖
  const [gtWave, setGtWave] = useState(() => generateWaveformData(800, 1)); // 原始混合音（mixture）
  const [sepWave, setSepWave] = useState([]); // 算法分离结果波形（separated）
  const [goldWave, setGoldWave] = useState(null); // 金标准单源波形（可选，来自用户上传）
  // 可见性开关：允许单独显示/隐藏混合音、金标准单源与分离结果
  const [showMixture, setShowMixture] = useState(true);
  const [showGold, setShowGold] = useState(true);
  const [showSeparated, setShowSeparated] = useState(true);
  const [gtSpectrum, setGtSpectrum] = useState([]);
  const [sepSpectrum, setSepSpectrum] = useState([]);
  const [gtFile, setGtFile] = useState(null); // 用户上传的"金标准"单源
  const gtFileRef = useRef(null); // 使用 ref 保存文件对象，避免状态更新时丢失
  // 音频元数据：采样率和位深度
  const [audioMetadata, setAudioMetadata] = useState({
    sampleRate: null,
    bitDepth: null,
    fileFormat: null, // 文件格式，用于显示解释
  });
  // 暂停时自动放大频谱图对应时间带
  const [autoZoomSpectrumOnPause, setAutoZoomSpectrumOnPause] = useState(false);
  // 音频资源选择器状态
  const [showResourceSelector, setShowResourceSelector] = useState(false);
  const [resourceSelectorType, setResourceSelectorType] = useState(null); // 'input' 或 'gold'
  
  // 折叠状态管理
  const [collapsedSections, setCollapsedSections] = useState({
    inputSource: false, // 默认展开
    goldStandard: false, // 默认展开
    algorithm: false, // 默认展开
    stemSource: false, // 默认展开
    objectiveMetrics: false, // 默认展开
  });
  
  const toggleSection = (section) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const computeMasterDuration = useCallback(() => {
    const dInput = inputPlaybackRef.current?.duration;
    const dGold = goldPlaybackRef.current?.duration;
    const dStem = stemPlaybackRef.current?.duration;
    const pick = (d) => (typeof d === "number" && isFinite(d) && d > 0 ? d : 0);
    return pick(dInput) || pick(dGold) || pick(dStem) || 0;
  }, []);

  const computeAnyPlaying = useCallback(() => {
    return !!(
      inputPlaybackRef.current?.playing ||
      goldPlaybackRef.current?.playing ||
      stemPlaybackRef.current?.playing
    );
  }, []);

  const seekAll = useCallback(
    (time, options = {}) => {
      const t = Math.max(0, typeof time === "number" && isFinite(time) ? time : 0);
      const skip = options?.skip;

      // 先更新全局时间，保证波形图进度线立即响应
      setSyncedCurrentTime(t);
      setSyncedDuration(computeMasterDuration());

      const targets = [
        { key: "input", ref: inputPlaybackRef },
        { key: "gold", ref: goldPlaybackRef },
        { key: "stem", ref: stemPlaybackRef },
      ];

      targets.forEach(({ key, ref }) => {
        if (skip && key === skip) return;
        const fn = ref.current?.seek;
        if (typeof fn === "function") fn(t);
      });
    },
    [computeMasterDuration],
  );

  const handlePlayerStateChange = useCallback(
    (key, state) => {
      if (!state) return;
      if (key === "input") inputPlaybackRef.current = state;
      if (key === "gold") goldPlaybackRef.current = state;
      if (key === "stem") stemPlaybackRef.current = state;

      if (state.playing) activePlayerKeyRef.current = key;

      // duration：优先 Input（混合音），否则 gold/stem 兜底
      setSyncedDuration(computeMasterDuration());

      // playing：三者任意一个播放即为 true（实际逻辑上会互斥，但这里更健壮）
      setSyncedPlaying(computeAnyPlaying());

      // currentTime：只跟随“当前正在播放/最近活跃”的那一路，避免被其他暂停播放器的回调干扰
      const activeKey = activePlayerKeyRef.current;
      const shouldFollow =
        state.playing || activeKey === key || activeKey === null;
      if (shouldFollow && typeof state.currentTime === "number" && isFinite(state.currentTime)) {
        setSyncedCurrentTime(state.currentTime);
      }
    },
    [computeAnyPlaying, computeMasterDuration],
  );

  const playbackState = useMemo(
    () => ({
      currentTime: syncedCurrentTime,
      duration: syncedDuration,
      playing: syncedPlaying,
      seek: (t) => seekAll(t),
    }),
    [syncedCurrentTime, syncedDuration, syncedPlaying, seekAll],
  );

  // 根据当前视窗计算等效放大倍数，供 UI 展示
  const zoomLevel = useMemo(() => {
    const span = Math.max(0.0001, (viewRange?.end || 1) - (viewRange?.start || 0));
    return Math.round(1 / span);
  }, [viewRange]);

  const handleZoomIn = () => {
    setViewRange((prev) => {
      const start = prev?.start ?? 0;
      const end = prev?.end ?? 1;
      const span = Math.max(0.0001, end - start);
      const center = start + span / 2;
      const newSpan = Math.max(0.02, span / 1.5);
      const newStart = Math.max(0, center - newSpan / 2);
      const newEnd = Math.min(1, center + newSpan / 2);
      return { start: newStart, end: newEnd };
    });
  };

  const handleZoomOut = () => {
    setViewRange((prev) => {
      const start = prev?.start ?? 0;
      const end = prev?.end ?? 1;
      const span = Math.max(0.0001, end - start);
      const center = start + span / 2;
      const newSpan = Math.min(1, span * 1.5);
      let newStart = center - newSpan / 2;
      let newEnd = center + newSpan / 2;
      if (newStart < 0) {
        newEnd -= newStart;
        newStart = 0;
      }
      if (newEnd > 1) {
        const diff = newEnd - 1;
        newStart -= diff;
        newEnd = 1;
        if (newStart < 0) newStart = 0;
      }
      return { start: newStart, end: newEnd };
    });
  };

  // 监听播放状态，当暂停时自动放大频谱图对应时间带
  useEffect(() => {
    if (!autoZoomSpectrumOnPause) return;
    if (!playbackState.duration || playbackState.duration <= 0) return;
    if (playbackState.playing) return; // 只在暂停时触发

    const currentTime = playbackState.currentTime;
    const duration = playbackState.duration;
    const currentPos = currentTime / duration; // 0~1

    // 设置一个较小的时间窗口（当前时间前后各5%）
    const windowSize = 0.1; // 10% 的时间窗口
    const newStart = Math.max(0, currentPos - windowSize / 2);
    const newEnd = Math.min(1, currentPos + windowSize / 2);

    // 只有当新的范围与当前范围不同时才更新，避免无限循环
    setViewRange((prev) => {
      const currentStart = prev?.start ?? 0;
      const currentEnd = prev?.end ?? 1;
      const threshold = 0.01; // 1% 的容差
      if (
        Math.abs(newStart - currentStart) > threshold ||
        Math.abs(newEnd - currentEnd) > threshold
      ) {
        return { start: newStart, end: newEnd };
      }
      return prev; // 没有变化时返回原值
    });
  }, [playbackState.playing, playbackState.currentTime, playbackState.duration, autoZoomSpectrumOnPause]);

  // Auth Effect - 检查本地存储的 token
  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem("auth_token");
      if (token) {
        try {
          const resp = await fetch(`${API_BASE}/api/auth/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (resp.ok) {
            const userData = await resp.json();
            setUser(userData);
            setAuthToken(token);
          } else {
            localStorage.removeItem("auth_token");
          }
        } catch (err) {
          console.error("Auth check failed:", err);
          localStorage.removeItem("auth_token");
        }
      }
    };
    initAuth();
  }, []);

  // Keep URL <-> currentView in sync, so pages are shareable via link.
  useEffect(() => {
    // 确保在浏览器环境中执行
    if (typeof window === "undefined") return;
    
    const path = normalizePathname(location?.pathname);
    // Admin area is handled by admin components (their own URL->tab sync).
    // We must not treat /admin/* as an "unknown path" and redirect to "/".
    if (path === "/admin" || path.startsWith("/admin/")) return;

    const viewFromPath = PATH_TO_VIEW[path];
    if (!viewFromPath) {
      // Unknown path -> back to dashboard
      try {
        navigate("/", { replace: true });
      } catch (error) {
        console.warn("Navigation error:", error);
        // 如果 navigate 失败，使用 window.location 作为后备
        if (window.location.pathname !== "/") {
          window.history.replaceState(null, "", "/");
        }
      }
      return;
    }
    if (currentView !== viewFromPath) {
      setCurrentView(viewFromPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.pathname, navigate]);

  useEffect(() => {
    // 确保在浏览器环境中执行
    if (typeof window === "undefined") return;
    
    const path = normalizePathname(location?.pathname);
    // If we are currently under /admin/*, do not force user-view navigation.
    if (path === "/admin" || path.startsWith("/admin/")) return;

    const targetPath = VIEW_TO_PATH[currentView] || "/";
    const currentPath = normalizePathname(location?.pathname);
    if (currentPath !== targetPath && targetPath) {
      try {
        navigate(targetPath, { replace: false });
      } catch (error) {
        console.warn("Navigation error:", error);
        // 如果 navigate 失败，使用 window.location 作为后备
        if (window.location.pathname !== targetPath) {
          window.history.pushState(null, "", targetPath);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  const handleLoginSuccess = (userData, token) => {
    setUser(userData);
    setAuthToken(token);
  };

  // 获取未读通知数量
  const fetchUnreadNotificationCount = useCallback(async () => {
    if (!authToken || !user) return false;
    try {
      const resp = await fetch(`${API_BASE}/api/system/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setUnreadNotificationCount(data.count || 0);
        return true;
      } else if (resp.status === 404) {
        // API 不存在，设置默认值
        setUnreadNotificationCount(0);
        return false;
      }
    } catch (err) {
      // 网络错误或其他错误，静默处理（避免控制台噪音）
      // 如果是404，浏览器会自动记录，但我们已经处理了
      return false;
    }
    return true;
  }, [authToken, user]);

  // 定期刷新未读通知数量
  useEffect(() => {
    if (!authToken || !user) {
      setUnreadNotificationCount(0);
      return;
    }
    let apiExists = true;
    let intervalId = null;
    
    // 首次检查
    fetchUnreadNotificationCount().then((exists) => {
      apiExists = exists !== false;
      // 如果API存在，才设置定时器
      if (apiExists) {
        intervalId = setInterval(() => {
          fetchUnreadNotificationCount().then((exists) => {
            if (exists === false) {
              apiExists = false;
              if (intervalId) {
                clearInterval(intervalId);
              }
            }
          });
        }, 30000); // 每30秒刷新一次
      }
    });
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [authToken, user, fetchUnreadNotificationCount]);

  const handleLogout = () => {
    localStorage.removeItem("auth_token");
    setUser(null);
    setAuthToken(null);
    window.location.reload();
  };

  // Fetch Stats Effect
  useEffect(() => {
    if (!user) return;
    // --- Firestore version (kept for easy restore) ---
    // const q = query(
    //   collection(db, "artifacts", appId, "public", "data", "scores"),
    //   orderBy("timestamp", "desc"),
    // );
    // const unsubscribe = onSnapshot(
    //   q,
    //   (snapshot) => {
    //     const scores = snapshot.docs.map((d) => d.data());
    //     setCommunityStats(scores);
    //   },
    //   (err) =>
    //     console.log("Stats fetch error (expected if permissions tight):", err),
    // );
    // return () => unsubscribe();

    // --- localStorage version ---
    const load = () => {
      const scores = readLocalScores().sort((a, b) => {
        const ta = typeof a?.timestamp === "number" ? a.timestamp : 0;
        const tb = typeof b?.timestamp === "number" ? b.timestamp : 0;
        return tb - ta;
      });
      setCommunityStats(scores);
    };

    load();
    const onStorage = (e) => {
      if (e.key === LS_SCORES_KEY) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user]);

  // Fetch Storage Mode from Backend (poll + tab focus)
  useEffect(() => {
    let cancelled = false;
    let apiExists = true;
    let intervalId = null;

    const fetchStorageMode = async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/system/storage-mode`);
        if (resp.ok) {
          const data = await resp.json();
          if (!cancelled) {
            setStorageMode(data.storage_mode || "local");
          }
          return true;
        } else if (resp.status === 404) {
          // API 不存在，使用默认值，不再继续请求
          if (!cancelled) {
            setStorageMode("local");
          }
          return false; // 返回 false 表示 API 不存在
        }
      } catch (err) {
        // 如果获取失败，使用默认值
        // 网络错误时也返回false，避免重复请求
        if (!cancelled) {
          setStorageMode("local");
        }
        return false;
      }
      return true;
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && apiExists) {
        fetchStorageMode().then((exists) => {
          if (exists === false) {
            apiExists = false;
            if (intervalId) {
              clearInterval(intervalId);
            }
          }
        });
      }
    };

    // 首次加载
    fetchStorageMode().then((exists) => {
      apiExists = exists !== false;
      // 如果API存在，才设置定时器和事件监听
      if (apiExists) {
        intervalId = setInterval(() => {
          if (apiExists) {
            fetchStorageMode().then((exists) => {
              if (exists === false) {
                apiExists = false;
                if (intervalId) {
                  clearInterval(intervalId);
                }
              }
            });
          }
        }, 30000); // 30 秒轮询
        
        document.addEventListener("visibilitychange", handleVisibility);
      }
    });
    
    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Fetch Backend Stats Effect
  useEffect(() => {
    const fetchBackendStats = async () => {
      setLoadingStats(true);
      try {
        // 获取详细统计
        const detailedResp = await fetch(`${API_BASE}/api/scores/stats/detailed`);
        if (detailedResp.ok) {
          const detailedData = await detailedResp.json();
          setBackendStats(detailedData);
        }

        // 获取算法对比统计
        const comparisonResp = await fetch(`${API_BASE}/api/scores/stats/algorithm-comparison`);
        if (comparisonResp.ok) {
          const comparisonData = await comparisonResp.json();
          setAlgorithmComparison(comparisonData);
        }
      } catch (err) {
        console.error("Failed to fetch backend stats:", err);
      } finally {
        setLoadingStats(false);
      }
    };

    if (user) {
      fetchBackendStats();
      // 每30秒刷新一次统计数据
      const interval = setInterval(fetchBackendStats, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  // Handlers
  /*const handleFileUpload = (e) => {
    // Simulate upload
    setFile({ name: "jazz_improvisation_01.wav", size: "12.4 MB" });
  };*/
  const handlePick = () => fileInputRef.current?.click();

  // 处理从资源库选择的音频
  const handleResourceSelect = async (file, resource) => {
    if (resourceSelectorType === 'input') {
      // 设置为 INPUT SOURCE
      setRawFile(file);
      setFile({
        name: file.name,
        size: (file.size / 1024 / 1024).toFixed(2) + " MB",
      });
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
    } else if (resourceSelectorType === 'gold') {
      // 设置为 GOLD STANDARD STEM
      gtFileRef.current = file;
      setGtFile({
        name: file.name,
        size: (file.size / 1024 / 1024).toFixed(2) + " MB",
        raw: file,
      });
      // 解析波形
      const wf = await decodeFileToWaveform(file, 800);
      setGoldWave(wf);
    }
    setShowResourceSelector(false);
    setResourceSelectorType(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // 真正处理拖放文件
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // 取出拖进来的第一个文件
    console.log("【DROP】拖放事件触发"); // ← 新增
    const dropped = e.dataTransfer.files[0];
    console.log("【DROP】拿到的文件", dropped); // ← 新增
    if (!dropped) return;
    setRawFile(dropped);

    // 1. 显示文件名、大小
    setFile({
      name: dropped.name,
      size: (dropped.size / 1024 / 1024).toFixed(2) + " MB",
    });

    // 2. 生成本地播放地址
    const url = URL.createObjectURL(dropped);
    // 用「真实小 WAV」替换空 Blob
    //const realFile = new File([createSilenceWav()], file.name, {
    //type: "audio/wav",
    //});
    //const url = URL.createObjectURL(realFile);
    setAudioUrl(url);
  };

  const notifySeparationDone = useCallback(
    (algoName) => {
      const msg = algoName ? `处理完成：${algoName}` : "处理完成";
      showSuccess(msg);
      // 如果用户切到其他标签页，且已授权系统通知，则额外发一个系统通知（不主动弹权限请求）
      try {
        if (
          document?.hidden &&
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          new Notification("AudioLab", { body: msg });
        }
      } catch (e) {
        // ignore
      }
    },
    [showSuccess],
  );

  const runSeparation = async (algo) => {
    setIsProcessing(true);
    setSelectedAlgo(algo);
    setResults(null);
    setStems([]);
    setCurrentStem(null);
    setTaskId(null);
    setProgressText("准备上传文件...");

    try {
      if (!rawFile) {
        showError("请先拖拽/选择一个音频文件");
        setIsProcessing(false);
        return;
      }

      // 1) 上传文件，创建任务
      setProgressText("正在上传音频文件...");
      const form = new FormData();
      form.append("file", rawFile);
      const uploadResp = await fetch(
        `${API_BASE}/api/tasks/upload?algorithm=${encodeURIComponent(algo)}`,
        { method: "POST", body: form },
      );
      if (!uploadResp.ok) throw new Error(await uploadResp.text());
      
      // 先获取原始文本，然后手动解析，确保大整数不被JavaScript自动转换
      let responseText = await uploadResp.text();
      
      // 关键修复：在 JSON.parse 之前，用正则表达式将 "id":数字 替换为 "id":"数字字符串"
      // 这样可以避免 JavaScript 在解析时丢失精度
      const idPattern = /"id"\s*:\s*(\d+)/g;
      if (idPattern.test(responseText)) {
        responseText = responseText.replace(/"id"\s*:\s*(\d+)/, `"id":"$1"`);
      }
      
      // 现在可以安全地解析 JSON，ID 已经是字符串格式
      const task = JSON.parse(responseText);
      
      // 确保 task.id 是字符串类型
      const taskIdStr = typeof task.id === 'string' ? task.id : String(task.id);
      
      // 验证 task.id 是否存在
      if (!task.id) {
        throw new Error("任务创建失败：未收到任务ID");
      }
      
      setTaskId(taskIdStr);
      setProgressText("任务已创建，等待处理...");

      // 2) 轮询任务状态直到完成/失败
      // 先等待一小段时间，确保任务已写入数据库
      await new Promise((res) => setTimeout(res, 500));
      
      const poll = async () => {
        const url = `${API_BASE}/api/tasks/${taskIdStr}`;
        
        try {
          const r = await fetch(url);
          let responseText = await r.text();
          
          if (!r.ok) {
            // 尝试解析错误详情
            let errorDetail = responseText;
            try {
              const errorObj = JSON.parse(responseText);
              errorDetail = errorObj.detail || JSON.stringify(errorObj);
            } catch (e) {
              // 如果解析失败，使用原始文本
            }
            throw new Error(`任务查询失败: ${errorDetail}`);
          }
          
          // 在解析前修复ID字段，避免精度丢失
          const idPattern = /"id"\s*:\s*(\d+)/g;
          if (idPattern.test(responseText)) {
            responseText = responseText.replace(/"id"\s*:\s*(\d+)/, `"id":"$1"`);
          }
          
          // 解析响应，确保ID保持为字符串
          const taskData = JSON.parse(responseText);
          return taskData;
        } catch (e) {
          if (e.message.includes('任务查询失败')) {
            throw e;
          }
          throw new Error(`网络请求失败: ${e.message}`);
        }
      };

      let t = await poll();
      let lastStatus = null;
      
      while (t.status === "pending" || t.status === "processing") {
        if (t.status !== lastStatus) {
          if (t.status === "pending") {
            setProgressText("任务排队中，请稍候...");
          } else if (t.status === "processing") {
            // 不展示进度条，仅提示处理中
            setProgressText("正在处理中...");
          }
          lastStatus = t.status;
        }
        
        await new Promise((res) => setTimeout(res, 1200));
        t = await poll();
      }
      
      if (t.status !== "completed") {
        setProgressText("");
        // 如果任务有错误信息，显示它
        const errorMsg = t.comment || "任务失败或被中断";
        throw new Error(errorMsg);
      }
      
      // 任务完成
      setProgressText("处理完成，正在加载结果...");

      // 3) 拉取 stems 列表，并用下载链接作为播放源
      const stemsResp = await fetch(`${API_BASE}/api/tasks/${taskIdStr}/stems`);
      if (!stemsResp.ok) throw new Error(await stemsResp.text());
      
      // 修复 stem ID 精度问题（与 task ID 相同）
      let stemsResponseText = await stemsResp.text();
      
      // 在解析前修复所有 stem 的 ID 字段
      const stemIdPattern = /"id"\s*:\s*(\d+)/g;
      if (stemIdPattern.test(stemsResponseText)) {
        stemsResponseText = stemsResponseText.replace(/"id"\s*:\s*(\d+)/g, `"id":"$1"`);
      }
      
      const stemList = JSON.parse(stemsResponseText);
      setProgressText("完成！");
      
      const stemsMapped = (stemList || []).map((s) => {
        // 确保 stem ID 是字符串
        const stemIdStr = typeof s.id === 'string' ? s.id : String(s.id);
        return {
          name: s.stem_name,
          // 后端下载链接（备用），我们会尝试预抓取并转换为本地 File 以确保播放稳定
          src: `${API_BASE}/api/tasks/${taskIdStr}/stems/${stemIdStr}/download`,
          waveform: generateWaveformData(800, Math.random() * 2), // fallback
          spectrum: generateSpectrumData(160, 90), // fallback
        };
      });

      // 尝试并行预取每个 stem 的音频，转换成 File（以便 StemPlayer 使用 createObjectURL）
      const stemsWithFiles = await Promise.all(
        stemsMapped.map(async (s) => {
          try {
            console.log(`[runSeparation] 正在预取 stem: ${s.name}, URL: ${s.src}`);
            const resp = await fetch(s.src);
            if (!resp.ok) throw new Error(`fetch stem failed: ${resp.status}`);
            const blob = await resp.blob();
            console.log(`[runSeparation] 预取成功: ${s.name}`, {
              blobSize: blob.size,
              blobType: blob.type,
              url: s.src,
            });
            // 保持一个合理的文件名
            const ext = blob.type?.includes("mpeg") ? "mp3" : blob.type?.includes("wav") ? "wav" : "bin";
            const filename = s.name ? `${s.name}.${ext}` : `stem.${ext}`;
            const fileObj = new File([blob], filename, { type: blob.type || "audio/wav" });
            return {
              ...s,
              file: fileObj,
              // 清除远程 src，让 StemPlayer 使用 file 来创建 object URL 并负责回收
              src: undefined,
            };
          } catch (e) {
            console.warn(`[runSeparation] Stem prefetch failed (${s.name}), falling back to remote src:`, e);
            return s;
          }
        }),
      );
      
      console.log(`[runSeparation] 所有 stems 预取完成:`, stemsWithFiles.map(s => ({
        name: s.name,
        fileSize: s.file?.size,
        fileName: s.file?.name,
        hasFile: !!s.file,
        hasSrc: !!s.src,
      })));

      setStems(stemsWithFiles);
      notifySeparationDone(algo);

      // 如果有鼓轨，默认选中鼓轨用于对比；否则选第一条
      const defaultStem =
        stemsWithFiles.find(
          (s) => typeof s.name === "string" && /drum/i.test(s.name),
        ) || stemsWithFiles[0];
      if (defaultStem) {
        setCurrentStem(defaultStem);
      }

      // 4) 客观指标（来自后端任务）
      setResults({
        sdr: t.sdr,
        sir: t.sir,
        sar: t.sar,
        comment: t.comment,
      });

      // 波形：先用模拟数据占位（后续可以从音频解码真实绘制）
      setSepWave(generateWaveformData(800, 1));

      // 5) 拉取后端分析结果（波形 + 频谱），用于替换 mock
      try {
        const aResp = await fetch(
          `${API_BASE}/api/tasks/${taskIdStr}/analysis?target=Vocals&include_all_stems=true`,
        );
        if (aResp.ok) {
          // 修复分析数据中的 task_id 精度问题
          let analysisResponseText = await aResp.text();
          const analysisIdPattern = /"task_id"\s*:\s*(\d+)/g;
          if (analysisIdPattern.test(analysisResponseText)) {
            analysisResponseText = analysisResponseText.replace(/"task_id"\s*:\s*(\d+)/g, `"task_id":"$1"`);
          }
          const a = JSON.parse(analysisResponseText);
          if (a?.original?.waveform?.length) setGtWave(a.original.waveform);
          if (a?.target?.waveform?.length) setSepWave(a.target.waveform);
          if (a?.original?.spectrogram?.length) setGtSpectrum(a.original.spectrogram);
          if (a?.target?.spectrogram?.length) setSepSpectrum(a.target.spectrogram);
          // 保存音频元数据（优先使用 original 的，如果没有则使用 target 的，再尝试从 stems 获取）
          const originalData = a?.original;
          const targetData = a?.target;
          const stemsData = a?.stems;
          
          let metadataFound = false;
          
          // 1. 优先从 original 获取
          if (originalData && (originalData.sample_rate !== undefined && originalData.sample_rate !== null)) {
            console.log("【元数据】从 original 获取:", {
              sample_rate: originalData.sample_rate,
              bit_depth: originalData.bit_depth,
            });
            setAudioMetadata({
              sampleRate: originalData.sample_rate,
              bitDepth: originalData.bit_depth !== undefined ? originalData.bit_depth : null,
              fileFormat: null, // 后端数据不包含格式信息
            });
            metadataFound = true;
          } 
          // 2. 其次从 target 获取
          else if (targetData && (targetData.sample_rate !== undefined && targetData.sample_rate !== null)) {
            console.log("【元数据】从 target 获取:", {
              sample_rate: targetData.sample_rate,
              bit_depth: targetData.bit_depth,
            });
            setAudioMetadata({
              sampleRate: targetData.sample_rate,
              bitDepth: targetData.bit_depth !== undefined ? targetData.bit_depth : null,
              fileFormat: null, // 后端数据不包含格式信息
            });
            metadataFound = true;
          }
          // 3. 尝试从 stems 中获取（取第一个有效的）
          else if (stemsData && typeof stemsData === 'object') {
            for (const [stemName, stemData] of Object.entries(stemsData)) {
              if (stemData && stemData.sample_rate !== undefined && stemData.sample_rate !== null) {
                console.log("【元数据】从 stem 获取:", stemName, {
                  sample_rate: stemData.sample_rate,
                  bit_depth: stemData.bit_depth,
                });
                setAudioMetadata({
                  sampleRate: stemData.sample_rate,
                  bitDepth: stemData.bit_depth !== undefined ? stemData.bit_depth : null,
                  fileFormat: null, // 后端数据不包含格式信息
                });
                metadataFound = true;
                break;
              }
            }
          }
          
          // 4. 如果都没有，尝试从上传的原始文件中获取
          if (!metadataFound && rawFile) {
            console.log("【元数据】尝试从原始文件获取...");
            try {
              const AudioCtx = window.AudioContext || window.webkitAudioContext;
              if (AudioCtx) {
                const arrayBuffer = await rawFile.arrayBuffer();
                
                // 先尝试从文件头部解析位深度和格式
                let bitDepth = null;
                let detectedFormat = null;
                const fileName = rawFile.name.toLowerCase();
                const fileType = rawFile.type;
                
                // 从文件扩展名推断格式
                const getFormatFromExtension = (name) => {
                  if (name.endsWith('.wav') || name.endsWith('.wave')) return 'WAV';
                  if (name.endsWith('.mp3')) return 'MP3';
                  if (name.endsWith('.flac')) return 'FLAC';
                  if (name.endsWith('.ogg') || name.endsWith('.oga')) return 'OGG';
                  if (name.endsWith('.m4a') || name.endsWith('.aac')) return 'AAC';
                  if (name.endsWith('.wma')) return 'WMA';
                  return null;
                };
                
                detectedFormat = getFormatFromExtension(fileName);
                
                console.log("【元数据】文件信息:", {
                  fileName: rawFile.name,
                  fileType: fileType,
                  detectedFormat: detectedFormat,
                  fileSize: rawFile.size,
                });
                
                // 尝试解析文件头部（不限于 WAV，也检查文件魔数）
                try {
                  const view = new DataView(arrayBuffer);
                  if (arrayBuffer.byteLength >= 12) {
                    // 检查文件魔数
                    const magic = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(0, 4)));
                    console.log("【元数据】文件魔数:", magic);
                    
                    if (magic === "RIFF") {
                      const wave = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(8, 12)));
                      console.log("【元数据】WAVE 标识:", wave);
                      
                      if (wave === "WAVE") {
                        detectedFormat = 'WAV';
                        // 查找 "fmt " chunk
                        let offset = 12;
                        let foundFmt = false;
                        while (offset < arrayBuffer.byteLength - 8) {
                          const chunkId = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(offset, offset + 4)));
                          const chunkSize = view.getUint32(offset + 4, true);
                          
                          console.log("【元数据】找到 chunk:", chunkId, "大小:", chunkSize, "偏移:", offset);
                          
                          if (chunkId === "fmt ") {
                            foundFmt = true;
                            // 位深度在 fmt chunk 的第 22-23 字节（从 chunk 开始计算，即 offset + 22）
                            if (offset + 22 < arrayBuffer.byteLength) {
                              bitDepth = view.getUint16(offset + 22, true);
                              console.log("【元数据】从 WAV 文件头部解析到位深度:", bitDepth);
                            } else {
                              console.warn("【元数据】fmt chunk 太小，无法读取位深度");
                            }
                            break;
                          }
                          
                          offset += 8 + chunkSize;
                          // 对齐到偶数边界
                          if (chunkSize % 2 !== 0) offset += 1;
                          
                          // 防止无限循环
                          if (offset >= arrayBuffer.byteLength) break;
                        }
                        
                        if (!foundFmt) {
                          console.warn("【元数据】未找到 fmt chunk");
                        }
                      }
                    } else if (magic.slice(0, 2) === "ID" || magic === "ID3") {
                      detectedFormat = detectedFormat || 'MP3';
                    } else if (magic === "fLaC") {
                      detectedFormat = 'FLAC';
                    } else if (magic === "OggS") {
                      detectedFormat = 'OGG';
                    }
                    
                    if (!detectedFormat) {
                      detectedFormat = getFormatFromExtension(fileName) || '未知格式';
                    }
                  } else {
                    console.warn("【元数据】文件太小，无法解析头部");
                    detectedFormat = detectedFormat || getFormatFromExtension(fileName) || '未知格式';
                  }
                } catch (e) {
                  console.warn("【元数据】解析文件头部失败:", e);
                  detectedFormat = detectedFormat || getFormatFromExtension(fileName) || '未知格式';
                }
                
                // 使用 Web Audio API 获取采样率
                const audioCtx = new AudioCtx();
                let audioBuffer;
                if (audioCtx.decodeAudioData.length === 1) {
                  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
                } else {
                  audioBuffer = await new Promise((resolve, reject) => {
                    audioCtx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
                  });
                }
                const sampleRate = audioBuffer.sampleRate;
                
                console.log("【元数据】从原始文件获取:", {
                  sampleRate: sampleRate,
                  bitDepth: bitDepth,
                  fileFormat: detectedFormat,
                });
                setAudioMetadata({
                  sampleRate: sampleRate,
                  bitDepth: bitDepth,
                  fileFormat: detectedFormat,
                });
                audioCtx.close();
              }
            } catch (e) {
              console.warn("【元数据】从原始文件获取失败:", e);
            }
          }
          
          if (!metadataFound && !rawFile) {
            console.warn("【元数据】未找到 sample_rate 数据", {
              hasOriginal: !!originalData,
              hasTarget: !!targetData,
              hasStems: !!stemsData,
              originalSampleRate: originalData?.sample_rate,
              targetSampleRate: targetData?.sample_rate,
            });
          }

          if (a?.stems) {
            setStems((prev) =>
              (prev || []).map((st) => {
                const d = a.stems?.[st.name];
                if (!d) return st;
                return {
                  ...st,
                  waveform: Array.isArray(d.waveform) ? d.waveform : st.waveform,
                  spectrum: Array.isArray(d.spectrogram)
                    ? d.spectrogram
                    : st.spectrum,
                };
              }),
            );
          }
        } else {
          console.warn("analysis 接口失败：", await aResp.text());
        }
      } catch (e) {
        console.warn("analysis 拉取失败（可忽略，不阻塞主流程）：", e);
      }
    } catch (e) {
      console.error(e);
      showError(`分离失败：${e?.message || e}`);
      setProgressText("");
    } finally {
      setIsProcessing(false);
    }
  };

  const submitScore = async () => {
    if (!user || !selectedAlgo || !currentStem) {
      showError("请先选择需要评估的单一声源（stem），并完成分离任务。");
      return;
    }
    
    // 仅专家可提交评分
    if (user.role !== "expert") {
      showError("仅专家用户可提交主观评分");
      return;
    }

    const currentStemName = currentStem.name;
    // 当前 stem 的主观评分（滑条）
    const currentScore =
      stemScores[currentStemName] || {
        quality: 50,
        interference: 50,
        artifacts: 50,
      };

    // 当前任务的客观指标（来自后端任务结果），与该 stem 的主观评分一并存储
    const currentObjective = results
      ? {
          sdr: typeof results.sdr === "number" ? results.sdr : null,
          sir: typeof results.sir === "number" ? results.sir : null,
          sar: typeof results.sar === "number" ? results.sar : null,
          comment: results.comment || "",
        }
      : null;

    try {
      // --- Firestore version (kept for easy restore) ---
      // await addDoc(
      //   collection(db, "artifacts", appId, "public", "data", "scores"),
      //   {
      //     userId: user.uid,
      //     algorithm: selectedAlgo,
      //     scores: subjectiveScores,
      //     timestamp: serverTimestamp(),
      //   },
      // );

      // --- localStorage version ---
      const nextItem = {
        // 专家 / 用户标识
        userId: user.id,
        // 本次评估对应的分离任务与算法
        taskId: taskId || null,
        algorithm: selectedAlgo,
        // 单一声源维度（Vocals / Drums / Bass / Other 等）
        stemName: currentStemName,
        // 主观评分
        scores: currentScore,
        // 与该 stem 对应的一次性快照：当下任务的客观指标
        objective: currentObjective,
        // 记录时间（用于排序与趋势分析）
        timestamp: Date.now(),
      };
      const next = [nextItem, ...readLocalScores()];
      writeLocalScores(next);
      setCommunityStats(
        next.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)),
      );

      // --- backend version (recommended) ---
      if (taskId && authToken) {
        const resp = await fetch(`${API_BASE}/api/scores`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${authToken}`
          },
          body: JSON.stringify({
            task_id: taskId,
            algorithm: selectedAlgo,
            stem_name: currentStemName,
            quality: currentScore.quality,
            interference: currentScore.interference,
            artifacts: currentScore.artifacts,
          }),
        });
        if (!resp.ok) {
          // 不阻塞本地保存；仅提示
          console.warn("评分已本地保存，但后端提交失败：", await resp.text());
          showError("评分已保存到本地，但提交到后端失败（可查看控制台）");
          return;
        }
      }

      showSuccess("评分已提交（本地已保存，且已尝试提交到后端）！");
    } catch (e) {
      console.error(e);
      showError("提交失败，请重试");
    }
  };

  // Aggregated Stats for Chart
  const chartData = useMemo(() => {
    if (communityStats.length === 0)
      return [
        { subject: "Audio Quality", A: 80, B: 65, fullMark: 100 },
        { subject: "Interference", A: 75, B: 50, fullMark: 100 },
        { subject: "Artifacts", A: 90, B: 70, fullMark: 100 },
        { subject: "Dynamics", A: 85, B: 60, fullMark: 100 },
        { subject: "Timbre", A: 88, B: 68, fullMark: 100 },
      ];

    // 根据本地存储的评分数据，按算法聚合整体趋势（不区分 stem，作为概览）
    const aggByAlgo = {};
    communityStats.forEach((item) => {
      const algo = item.algorithm || "Unknown";
      const s = item.scores || {};
      const q = typeof s.quality === "number" ? s.quality : 0;
      const i = typeof s.interference === "number" ? s.interference : 0;
      const a = typeof s.artifacts === "number" ? s.artifacts : 0;
      if (!aggByAlgo[algo]) {
        aggByAlgo[algo] = {
          count: 0,
          quality: 0,
          interference: 0,
          artifacts: 0,
        };
      }
      aggByAlgo[algo].count += 1;
      aggByAlgo[algo].quality += q;
      aggByAlgo[algo].interference += i;
      aggByAlgo[algo].artifacts += a;
    });

    // 将聚合结果映射为简单的 "Overall"/"Interference Supp."/"Artifacts" 三个维度
    const algos = Object.keys(aggByAlgo);
    if (algos.length === 0) {
      return [
        { subject: "Audio Quality", A: 80, B: 65, fullMark: 100 },
        { subject: "Interference", A: 75, B: 50, fullMark: 100 },
        { subject: "Artifacts", A: 90, B: 70, fullMark: 100 },
      ];
    }

    const [algoA, algoB] = algos;
    const aData = aggByAlgo[algoA];
    const bData = aggByAlgo[algoB] || aData;

    const avg = (sum, count) => (count > 0 ? sum / count : 0);

    return [
      {
        subject: "Overall Quality",
        [algoA]: avg(aData.quality, aData.count),
        [algoB]: avg(bData.quality, bData.count),
        fullMark: 100,
      },
      {
        subject: "Interference Supp.",
        [algoA]: avg(aData.interference, aData.count),
        [algoB]: avg(bData.interference, bData.count),
        fullMark: 100,
      },
      {
        subject: "Artifacts",
        [algoA]: 100 - avg(aData.artifacts, aData.count),
        [algoB]: 100 - avg(bData.artifacts, bData.count),
        fullMark: 100,
      },
    ];
  }, [communityStats]);

  // 按算法 + stem 统计主观评分，用于“社区评估数据”页中按 stem 展示
  const stemStats = useMemo(() => {
    const map = {};
    communityStats.forEach((item) => {
      const algo = item.algorithm || "Unknown";
      const stemName = item.stemName || "ALL";
      const key = `${algo}::${stemName}`;
      const s = item.scores || {};
      const q = typeof s.quality === "number" ? s.quality : 0;
      const i = typeof s.interference === "number" ? s.interference : 0;
      const a = typeof s.artifacts === "number" ? s.artifacts : 0;
      if (!map[key]) {
        map[key] = {
          algorithm: algo,
          stemName,
          count: 0,
          quality: 0,
          interference: 0,
          artifacts: 0,
        };
      }
      map[key].count += 1;
      map[key].quality += q;
      map[key].interference += i;
      map[key].artifacts += a;
    });

    return Object.values(map).map((row) => ({
      ...row,
      avgQuality: row.count ? row.quality / row.count : 0,
      avgInterference: row.count ? row.interference / row.count : 0,
      avgArtifacts: row.count ? row.artifacts / row.count : 0,
    }));
  }, [communityStats]);


  if (!user) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

  // 管理员直接进入管理后台，不显示业务功能
  if (user.role === "admin") {
    return (
      <AdminDashboard
        user={user}
        authToken={authToken}
        onLogout={handleLogout}
      />
    );
  }

  // 普通用户（访客和专家）显示业务功能界面
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-cyan-500/30">
      {/* Navbar */}
      <header className="fixed top-0 w-full z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="text-cyan-400" />
            <span className="font-bold text-xl tracking-tight">
              Audio<span className="text-cyan-400">Lab</span>
            </span>
            <span className="ml-2 text-[10px] uppercase bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-slate-400">
              Beta v2.1
            </span>
          </div>

          <nav className="hidden md:flex gap-1 bg-slate-800/50 p-1 rounded-lg border border-slate-700/50">
            {[
              { id: "dashboard", label: "工作台", icon: Layers },
              { id: "stats", label: "社区评估数据", icon: BarChart2 },
              { id: "audio_resources", label: "音频资源", icon: Music },
              { id: "comments", label: "社区评论", icon: User },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(VIEW_TO_PATH[item.id] || "/")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition ${currentView === item.id ? "bg-cyan-600 text-white shadow-lg shadow-cyan-900/20" : "text-slate-400 hover:text-white hover:bg-slate-700"}`}
              >
                <item.icon size={14} /> {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div
              title="当前数据源（由管理员在系统设置中配置）"
              className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700/50 bg-slate-800/50 text-slate-300"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  storageMode === "local" ? "bg-emerald-400" : "bg-purple-400"
                }`}
              ></span>
              <span className="text-xs font-bold tracking-wide">
                数据源：{storageMode === "local" ? "本地" : "Firestore"}
              </span>
            </div>

            {/* 通知按钮 */}
            <button
              onClick={() => setShowNotificationCenter(true)}
              className="relative p-2 hover:bg-slate-800 rounded-lg transition"
              title="通知中心"
            >
              <Bell className="text-slate-400" size={20} />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                  {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                </span>
              )}
            </button>

            <AuthPanel 
              user={user} 
              onLogout={handleLogout}
            />
          </div>
        </div>
      </header>

      <main className="pt-24 pb-12 px-4 max-w-7xl mx-auto">
        {currentView === "dashboard" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Panel: Controls */}
            <div className="lg:col-span-3 space-y-6">
              {/* Upload Section */}
              <div
                className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50"
                title="Upload the mixture audio you want to separate and evaluate."
              >
                <h3 
                  className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2 cursor-pointer hover:text-slate-300 transition"
                  onClick={() => toggleSection('inputSource')}
                >
                  <Upload size={14} /> 1. Input Source
                  {collapsedSections.inputSource ? (
                    <ChevronRight size={16} className="ml-auto" />
                  ) : (
                    <ChevronDown size={16} className="ml-auto" />
                  )}
                </h3>
                {!collapsedSections.inputSource && (
                  <>
                {!file ? (
                  <div className="space-y-3">
                    <div
                      onClick={handlePick} // ← 只改这一行
                      onDrop={handleDrop} // ← 新增
                      onDragOver={handleDragOver} // ← 新增
                      onDragLeave={handleDragLeave} // ← 可选，样式还原
                      className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center hover:border-cyan-500 hover:bg-slate-800 transition cursor-pointer group"
                    >
                      <Music className="mx-auto text-slate-500 group-hover:text-cyan-400 mb-2 transition" />
                      <p className="text-sm text-slate-400">
                        拖拽音频文件或点击上传
                      </p>
                      <p className="text-xs text-slate-600 mt-2">
                        支持 WAV, MP3, FLAC
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-slate-700"></div>
                      <span className="text-xs text-slate-500">或</span>
                      <div className="flex-1 h-px bg-slate-700"></div>
                    </div>
                    <button
                      onClick={() => {
                        setResourceSelectorType('input');
                        setShowResourceSelector(true);
                      }}
                      className="w-full px-4 py-2 bg-slate-700/80 hover:bg-slate-600 border border-slate-600 hover:border-cyan-500/50 text-white rounded-lg transition flex items-center justify-center gap-2 text-sm font-medium"
                    >
                      <Music size={16} />
                      从音频资源库选择
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      onChange={(e) => {
                        console.log("【PICK】选中文件事件触发");
                        const picked = e.target.files[0];
                        console.log("【PICK】拿到的文件", picked);
                        if (!picked) return;

                        // 0. 保存真实 File，用于上传到后端（runSeparation 依赖这个）
                        setRawFile(picked);

                        // 1. 显示文件名、大小
                        setFile({
                          name: picked.name,
                          size:
                            (picked.size / 1024 / 1024).toFixed(2) + " MB",
                        });

                        // 2. 生成本地播放地址并打印
                        const url = URL.createObjectURL(picked);
                        console.log("【PICK】生成的播放地址", url); // ← 就是这句
                        setAudioUrl(url);
                      }} /*
                      onChange={(e) => {
                        console.log("【PICK】选中文件事件触发"); // ← 新增
                        const file = e.target.files[0];
                        console.log("【PICK】拿到的文件", file); // ← 新增
                        if (!file) return;
                        // 先只留文件名、大小，后面再播放
                        setFile({
                          name: file.name,
                          size: (file.size / 1024 / 1024).toFixed(2) + " MB",
                        });
                      }}*/
                      style={{ display: "none" }}
                    />
                  </div>
                ) : (
                  <div className="bg-slate-800 border border-cyan-900/30 rounded-lg p-3 flex items-center gap-3">
                    <div className="w-10 h-10 bg-cyan-900/50 rounded flex items-center justify-center text-cyan-400">
                      <Music size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-white">
                        {file.name}
                      </p>
                      <p className="text-xs text-slate-500">{file.size}</p>
                    </div>
                    <button
                      onClick={() => {
                        setFile(null);
                        setRawFile(null);
                        setAudioUrl(null);
                        setStems([]);
                        setCurrentStem(null);
                        setResults(null);
                      }}
                      className="text-slate-500 hover:text-red-400"
                    >
                      <LogOut size={14} />
                    </button>
                  </div>
                )}
                {audioUrl && (
                  <CustomPlayer
                    src={audioUrl}
                    onUserSeek={(t) => seekAll(t, { skip: "input" })}
                    onPlaybackStateChange={(state) => {
                      // 如果开始播放，暂停其他播放器
                      const wasPlaying = previousPlayingState.current.input;
                      const isNowPlaying = state.playing;
                      
                      // 先更新当前播放器的状态
                      previousPlayingState.current.input = isNowPlaying;
                      inputSourceAudioRef.current = state.audioRef;
                      
                      if (isNowPlaying && !wasPlaying) {
                        // 暂停金标准播放器（先检查是否真的在播放）
                        if (goldStandardAudioRef.current && !goldStandardAudioRef.current.paused) {
                          goldStandardAudioRef.current.pause();
                          previousPlayingState.current.gold = false;
                        }
                        // 暂停分离结果播放器（先检查是否真的在播放）
                        if (separatedStemAudioRef.current && !separatedStemAudioRef.current.paused) {
                          separatedStemAudioRef.current.pause();
                          previousPlayingState.current.separated = false;
                        }
                      }
                      
                      handlePlayerStateChange("input", state);
                    }}
                  />
                )}
                  </>
                )}
              </div>

              {/* Ground Truth 单源上传（可选：例如"金标准鼓轨"） */}
              <div
                className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50"
                title="Upload a clean reference stem (e.g. Gold Standard drum track) to visually compare against separated results."
              >
                <h3 
                  className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2 cursor-pointer hover:text-slate-300 transition"
                  onClick={() => toggleSection('goldStandard')}
                >
                    <Upload size={14} /> 2. Gold Standard Stem
                    {collapsedSections.goldStandard ? (
                      <ChevronRight size={16} className="ml-auto" />
                    ) : (
                      <ChevronDown size={16} className="ml-auto" />
                    )}
                </h3>
                {!collapsedSections.goldStandard && (
                  <>
                {!gtFile ? (
                  <div className="space-y-3">
                    <label className="block border-2 border-dashed border-slate-600 rounded-lg p-4 text-xs text-slate-400 cursor-pointer hover:border-cyan-500 hover:bg-slate-800 transition text-center">
                      {/* <span className="block truncate mb-1">
                        选择金标准参考音轨文件（WAV/MP3/FLAC）
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        用于与算法分离出的目标源做波形与频谱对比
                      </span> */}
                      <Music className="mx-auto text-slate-500 group-hover:text-cyan-400 mb-2 transition" />
                        <p className="text-sm text-slate-400">
                        选择金标准参考音轨文件
                        </p>
                        <p className="text-xs text-slate-600 mt-2">
                          支持 WAV/MP3/FLAC
                        </p>
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          // 使用 ref 保存文件对象
                          gtFileRef.current = f;
                          // 保存上传文件信息（用于 UI 显示）
                          setGtFile({
                            name: f.name,
                            size: (f.size / 1024 / 1024).toFixed(2) + " MB",
                            raw: f, // 仍然保存，但主要使用 ref
                          });
                          // 将其解析为用于可视化的波形，但不要覆盖后端返回的原始混合波形（gtWave）
                          const wf = await decodeFileToWaveform(f, 800);
                          setGoldWave(wf);
                        }}
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-slate-700"></div>
                      <span className="text-xs text-slate-500">或</span>
                      <div className="flex-1 h-px bg-slate-700"></div>
                    </div>
                    <button
                      onClick={() => {
                        setResourceSelectorType('gold');
                        setShowResourceSelector(true);
                      }}
                      className="w-full px-4 py-2 bg-slate-700/80 hover:bg-slate-600 border border-slate-600 hover:border-cyan-500/50 text-white rounded-lg transition flex items-center justify-center gap-2 text-sm font-medium"
                    >
                      <Music size={16} />
                      从音频资源库选择
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
                      <div className="min-w-0 mr-2">
                        <span className="truncate text-slate-200">{gtFile.name}</span>
                        &nbsp;&nbsp;
                        <span className="text-slate-500 text-[11px]">
                          {gtFile.size}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          gtFileRef.current = null;
                          setGtFile(null);
                          // 清除金标准单源波形（退回到无金标状态），但保留后端的混合音波形 gtWave
                          setGoldWave(null);
                        }}
                        className="text-slate-500 hover:text-red-400 text-[11px]"
                      >
                        清除
                      </button>
                    </div>
                    {/* Gold Standard 播放器 */}
                    {(gtFileRef.current || gtFile?.raw) && (
                      <div className="overflow-hidden rounded-lg border border-slate-700/60 bg-slate-900/60">
                        <StemPlayer
                          name="Gold Standard"
                          file={gtFileRef.current || (gtFile?.raw instanceof File ? gtFile.raw : null)}
                          onSelect={() => {}}
                          theme="purple"
                          onUserSeek={(t) => seekAll(t, { skip: "gold" })}
                          onPlaybackStateChange={(state) => {
                            // 如果开始播放，暂停其他播放器
                            const wasPlaying = previousPlayingState.current.gold;
                            const isNowPlaying = state.playing;
                            
                            // 先更新当前播放器的状态
                            previousPlayingState.current.gold = isNowPlaying;
                            goldStandardAudioRef.current = state.audioRef;
                            
                            if (isNowPlaying && !wasPlaying) {
                              // 暂停 INPUT SOURCE 播放器（先检查是否真的在播放）
                              if (inputSourceAudioRef.current && !inputSourceAudioRef.current.paused) {
                                inputSourceAudioRef.current.pause();
                                previousPlayingState.current.input = false;
                              }
                              // 暂停分离结果播放器（先检查是否真的在播放）
                              if (separatedStemAudioRef.current && !separatedStemAudioRef.current.paused) {
                                separatedStemAudioRef.current.pause();
                                previousPlayingState.current.separated = false;
                              }
                            }
                            
                            handlePlayerStateChange("gold", state);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
                  </>
                )}
              </div>

              {/* 3. Algorithm Selection */}
              <div
                className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50"
                title="Select which separation algorithm to run on your uploaded audio."
              >
                <h3 
                  className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2 cursor-pointer hover:text-slate-300 transition"
                  onClick={() => toggleSection('algorithm')}
                >
                  <Layers size={14} /> 3. Algorithm
                  {collapsedSections.algorithm ? (
                    <ChevronRight size={16} className="ml-auto" />
                  ) : (
                    <ChevronDown size={16} className="ml-auto" />
                  )}
                </h3>
                {!collapsedSections.algorithm && (
                  <>
                {!file && (
                  <div className="mb-4 p-3 bg-slate-900/50 border border-slate-700 rounded-lg text-xs text-slate-500">
                    ⚠️ 请先上传音频文件
                  </div>
                )}
                <div className="relative">
                  <select
                    value={selectedAlgo || ""}
                    onChange={(e) => {
                      const algo = e.target.value;
                      if (!algo) return;
                      if (!file) {
                        showError("请先上传音频文件！");
                        return;
                      }
                      runSeparation(algo);
                    }}
                    disabled={!file || isProcessing}
                    className={`w-full px-4 py-3 pr-10 rounded-lg border transition-all appearance-none cursor-pointer bg-slate-800 text-slate-300 text-sm font-medium focus:outline-none ${
                      !file || isProcessing
                        ? "bg-slate-900/50 border-slate-800 text-slate-600 cursor-not-allowed opacity-50"
                        : selectedAlgo
                          ? "border-cyan-500 bg-slate-800 hover:border-cyan-400 hover:bg-slate-700/50 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                          : "border-slate-700 hover:border-slate-500 hover:bg-slate-700/50 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                    }`}
                    style={{
                      backgroundImage: "none",
                    }}
                  >
                    <option value="" disabled className="bg-slate-800 text-slate-300">
                      {!file ? "请先上传音频文件" : isProcessing ? "处理中..." : "选择算法..."}
                    </option>
                    {ALGORITHMS.map((algo) => (
                      <option
                        key={algo}
                        value={algo}
                        className="bg-slate-800 text-slate-300"
                      >
                        {algo}
                      </option>
                    ))}
                  </select>
                  {/* 自定义下拉箭头 */}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    {isProcessing && selectedAlgo ? (
                      <Activity size={16} className="text-cyan-400 animate-pulse" />
                    ) : (
                      <ChevronRight
                        size={16}
                        className={`text-slate-500 transform rotate-90 ${
                          !file || isProcessing ? "opacity-50" : ""
                        }`}
                      />
                    )}
                  </div>
                  {/* 处理中提示（不显示进度条） */}
                  {isProcessing && (
                    <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                      <div className="inline-block animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-cyan-400" />
                      <span className="flex items-center gap-2">
                        <Activity size={14} className="text-cyan-400 animate-pulse" />
                        {progressText || "处理中..."}
                      </span>
                    </div>
                  )}
                  {/* 选中状态指示
                  {selectedAlgo && !isProcessing && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-cyan-400">
                      <CheckCircle size={12} />
                      <span>已选择: {selectedAlgo}</span>
                    </div>
                  )} */}
                </div>
                  </>
                )}
              </div>

              {/* 4. Stem 选择（下拉收起） + 当前 Stem 播放 */}
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 mt-4">
                <h3 
                  className="text-sm font-bold text-slate-400 uppercase mb-3 flex items-center gap-2 cursor-pointer hover:text-slate-300 transition"
                  onClick={() => toggleSection('stemSource')}
                >
                  <Layers size={14} /> 4. Stem Source
                  {collapsedSections.stemSource ? (
                    <ChevronRight size={16} className="ml-auto" />
                  ) : (
                    <ChevronDown size={16} className="ml-auto" />
                  )}
                </h3>
                {!collapsedSections.stemSource && (
                  <div className="space-y-3">
                  <div 
                    className="relative"
                    title="This dropdown is disabled before separation. After separation completes, you can select individual stems such as Vocals, Drums, Bass, or Other."
                  >
                    <select
                      value={currentStem?.name || ""}
                      onChange={(e) => {
                        const name = e.target.value;
                        const stem = stems.find((s) => s.name === name);
                        if (stem) setCurrentStem(stem);
                      }}
                      disabled={stems.length === 0 || isProcessing}
                      className={`w-full px-3 py-2 pr-8 rounded-lg border text-sm font-medium appearance-none transition ${
                        stems.length === 0 || isProcessing
                          ? "bg-slate-900/50 border-slate-800 text-slate-600 cursor-not-allowed opacity-60"
                          : "bg-slate-900 border-slate-700 text-slate-100 hover:border-cyan-500 hover:bg-slate-800/80 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                      }`}
                    >
                      <option
                        value=""
                        disabled
                        className="bg-slate-900 text-slate-200"
                      >
                        {stems.length === 0
                          ? "请先选择算法并完成音乐分离"
                          : "选择需要分析的 Stem 声源"}
                      </option>
                      {stems.map((s) => (
                        <option
                          key={s.name}
                          value={s.name}
                          className="bg-slate-900 text-slate-100"
                        >
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                      <ChevronRight
                        size={14}
                        className={`transform rotate-90 ${
                          stems.length === 0 || isProcessing
                            ? "text-slate-600"
                            : "text-slate-300"
                        }`}
                      />
                    </div>
                  </div>

                  {currentStem && (
                    <div className="mt-2">
                      <div className="overflow-hidden rounded-lg border border-slate-700/60 bg-slate-900/60">
                        <StemPlayer
                          name={currentStem.name}
                          file={currentStem.file}
                          src={currentStem.src}
                          onSelect={() => {}}
                          onUserSeek={(t) => seekAll(t, { skip: "stem" })}
                          onPlaybackStateChange={(state) => {
                            // 如果开始播放，暂停其他播放器
                            const wasPlaying = previousPlayingState.current.separated;
                            const isNowPlaying = state.playing;
                            
                            // 先更新当前播放器的状态
                            previousPlayingState.current.separated = isNowPlaying;
                            separatedStemAudioRef.current = state.audioRef;
                            
                            if (isNowPlaying && !wasPlaying) {
                              // 暂停 INPUT SOURCE 播放器（先检查是否真的在播放）
                              if (inputSourceAudioRef.current && !inputSourceAudioRef.current.paused) {
                                inputSourceAudioRef.current.pause();
                                previousPlayingState.current.input = false;
                              }
                              // 暂停金标准播放器（先检查是否真的在播放）
                              if (goldStandardAudioRef.current && !goldStandardAudioRef.current.paused) {
                                goldStandardAudioRef.current.pause();
                                previousPlayingState.current.gold = false;
                              }
                            }
                            
                            handlePlayerStateChange("stem", state);
                          }}
                        />
                      </div>
                      {/* <div className="mt-2 text-[10px] text-cyan-400 flex items-center gap-1">
                        <span>已选择:</span>
                        <span className="font-mono">{currentStem.name}</span>
                      </div> */}
                    </div>
                  )}
                </div>
                )}
              </div>

              {/* Objective Metrics (Show after process) */}
              {results && (
                <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 animate-in fade-in slide-in-from-bottom-4">
                  <h3 
                    className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2 cursor-pointer hover:text-slate-300 transition"
                    onClick={() => toggleSection('objectiveMetrics')}
                  >
                    <Award size={14} /> Objective Metrics
                    {collapsedSections.objectiveMetrics ? (
                      <ChevronRight size={16} className="ml-auto" />
                    ) : (
                      <ChevronDown size={16} className="ml-auto" />
                    )}
                  </h3>
                {!collapsedSections.objectiveMetrics && (
                  <>
              <div className="flex items-center gap-4 text-xs text-slate-400 mb-3">
                <div>
                  算法: <span className="font-mono text-cyan-400">{selectedAlgo || "未选择"}</span>
                </div>
                <div>
                  评估 Stem: <span className="font-mono text-cyan-400">{currentStem?.name || "未选择"}</span>
                </div>
              </div>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">
                          SDR (Signal-Distortion)
                        </span>
                        <span className="text-emerald-400 font-mono">
                          {results.sdr != null ? results.sdr.toFixed(2) : 'N/A'} dB
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${((results.sdr || 0) / 15) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">
                          SIR (Interference)
                        </span>
                        <span className="text-blue-400 font-mono">
                          {results.sir != null ? results.sir.toFixed(2) : 'N/A'} dB
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500"
                          style={{ width: `${((results.sir || 0) / 20) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                    <div className="p-3 bg-slate-800 rounded border border-slate-600 text-xs text-slate-300 mt-4 leading-relaxed">
                      <span className="text-cyan-400 font-bold">
                        AI Summary:
                      </span>{" "}
                      {results.comment}
                    </div>
                  </div>
                  </>
                )}
                </div>
              )}
            </div>

            {/* Center & Right Panel: Visualization & Evaluation */}
            <div className="lg:col-span-9 space-y-6">
              {/* 3. Visualization Panel */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-2xl overflow-hidden relative">
                {/* Toolbar */}
                <div className="bg-slate-800 px-4 py-2 flex items-center justify-between border-b border-slate-700">
                  <div className="flex items-center gap-4">
                    <h3 className="font-bold text-slate-200">可视化分析</h3>
                    <div className="flex gap-1 bg-slate-900 rounded p-0.5">
                      <button
                        onClick={handleZoomOut}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400"
                      >
                        <ZoomOut size={14} />
                      </button>
                      <span className="text-xs font-mono w-8 text-center py-1">
                        {zoomLevel}x
                      </span>
                      <button
                        onClick={handleZoomIn}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400"
                      >
                        <ZoomIn size={14} />
                      </button>
                      {/* Visibility toggles for mixture / gold / separated */}
                      <div className="flex items-center gap-1 ml-3 pr-2">
                        <button
                          title="切换混合音（Mixture）可见性"
                          onClick={() => setShowMixture((s) => !s)}
                          className={`text-xs px-2 py-0.5 rounded ${showMixture ? "bg-emerald-600/20 text-emerald-300" : "bg-slate-800 text-slate-400"}`}
                        >
                          Mix
                        </button>
                        <button
                          title="切换金标准单源（Gold）可见性"
                          onClick={() => setShowGold((s) => !s)}
                          className={`text-xs px-2 py-0.5 rounded ${showGold ? "bg-purple-600/20 text-purple-300" : "bg-slate-800 text-slate-400"}`}
                        >
                          Gold
                        </button>
                        <button
                          title="切换分离结果（Algorithm）可见性"
                          onClick={() => setShowSeparated((s) => !s)}
                          className={`text-xs px-2 py-0.5 rounded ${showSeparated ? "bg-cyan-600/20 text-cyan-300" : "bg-slate-800 text-slate-400"}`}
                        >
                          Alg
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs text-slate-500">
                    <span>
                      Sample Rate:{" "}
                      {audioMetadata.sampleRate
                        ? `${(audioMetadata.sampleRate / 1000).toFixed(1)}kHz`
                        : "未知"}
                    </span>
                    <span>
                      Bit Depth:{" "}
                      {audioMetadata.bitDepth
                        ? `${audioMetadata.bitDepth}bit`
                        : `未知${audioMetadata.fileFormat && audioMetadata.fileFormat !== 'WAV' ? ` (${audioMetadata.fileFormat} 格式无法直接获取位深度)` : ''}`}
                    </span>
                  </div>
                </div>

                {/* Canvases */}
                <div className="p-4 space-y-4">
                  {/* Processing Overlay */}
                  {isProcessing && (
                    <div className="absolute inset-0 bg-slate-900/80 z-20 flex flex-col items-center justify-center backdrop-blur-sm">
                      <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                      <p className="text-cyan-400 font-mono animate-pulse">
                        Running Neural Inference...
                      </p>
                      <p className="text-slate-500 text-xs mt-2">
                        Model: {selectedAlgo}
                      </p>
                    </div>
                  )}

                  {/* Waveform View */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                        Time Domain (Difference Overlay)
                      </span>
                      {/* 图例移到标题行右侧 */}
                      <div className="flex gap-4 text-xs font-mono bg-slate-800/50 px-3 py-1.5 rounded border border-slate-700/50">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          <span className="text-slate-300">Ground Truth</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                          <span className="text-slate-300">Algorithm</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-red-500/50"></span>
                          <span className="text-slate-300">High Error</span>
                        </div>
                      </div>
                    </div>
                    <WaveformComparator
                      groundTruth={gtWave}
                      goldWave={goldWave}
                      showMixture={showMixture}
                      showGold={showGold}
                      showSeparated={showSeparated}
                      separated={
                        currentStem?.waveform
                          ? currentStem.waveform
                          : results
                            ? sepWave
                            : []
                      }
                      viewRange={viewRange}
                      onViewRangeChange={setViewRange}
                      playbackState={playbackState}
                    />
                    {/* 操作说明放在波形图下方 */}
                    <div className="flex justify-center">
                      <div className="text-xs text-slate-400 bg-slate-800/30 px-3 py-1.5 rounded border border-slate-700/30">
                        <span className="mr-4">点击/拖动 → 跳转播放位置</span>
                        <span>Ctrl+拖动 → 缩放波形图</span>
                      </div>
                    </div>
                  </div>

                  {/* Spectrum View */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                        Frequency Domain (Spectrogram)
                      </span>
                      {/* 暂停时自动放大选项 */}
                      {playbackState.duration > 0 && (
                        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer hover:text-slate-300 transition">
                          <input
                            type="checkbox"
                            checked={autoZoomSpectrumOnPause}
                            onChange={(e) => setAutoZoomSpectrumOnPause(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-2 focus:ring-cyan-500/20 focus:ring-offset-0 focus:ring-offset-slate-900 cursor-pointer"
                          />
                          <span className="select-none">
                            暂停时自动放大对应时间带
                          </span>
                        </label>
                      )}
                    </div>

                    <SpectrumComparator
                      isActive={
                        !!results &&
                        !!(
                          (currentStem && currentStem.spectrum) ||
                          sepSpectrum.length
                        )
                      }
                      originalSpectrumData={gtSpectrum}
                      separatedSpectrumData={
                        currentStem?.spectrum || sepSpectrum
                      }
                      viewRange={viewRange}
                      onViewRangeChange={setViewRange}
                    />
                  </div>
                </div>
              </div>

              {/* 4. Subjective Evaluation Panel - 仅专家可见 */}
              {user?.role === "expert" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-700/50">
                    <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                      <Headphones size={18} className="text-purple-400" />{" "}
                      专家主观评分（按 Stem）
                    </h3>
                    <p className="text-xs text-slate-400 mb-6">
                      请基于当前选中的单一声源（stem），对其清晰度、干扰抑制与伪影控制分别打分。
                    </p>

                    <div className="space-y-6">
                      <div className="text-xs text-slate-400 mb-2">
                        当前算法：{" "}
                        <span className="font-mono text-cyan-400">
                          {selectedAlgo || "未选择"}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mb-2">
                        当前评估目标：{" "}
                        <span className="font-mono text-cyan-400">
                          {currentStem?.name || "未选择"}
                        </span>
                      </div>

                      {(() => {
                        const stemName = currentStem?.name || "GLOBAL";
                        const currentScore =
                          stemScores[stemName] || {
                            quality: 50,
                            interference: 50,
                            artifacts: 50,
                          };
                        const metrics = [
                          {
                            key: "quality",
                            label: "Quality (整体质量)",
                          },
                          {
                            key: "interference",
                            label: "Interference (干扰抑制)",
                          },
                          {
                            key: "artifacts",
                            label: "Artifacts (伪影控制)",
                          },
                        ];
                        return metrics.map((m) => (
                          <div key={m.key}>
                            <div className="flex justify-between text-sm mb-2">
                              <span className="text-slate-300">{m.label}</span>
                              <span className="font-mono text-cyan-400">
                                {currentScore[m.key]}
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={currentScore[m.key]}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                setStemScores((prev) => ({
                                  ...prev,
                                  [stemName]: {
                                    ...(prev[stemName] || currentScore),
                                    [m.key]: v,
                                  },
                                }));
                              }}
                              disabled={!results || !currentStem}
                              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                            />
                          </div>
                        ));
                      })()}

                      <button
                        onClick={submitScore}
                        disabled={!results || !currentStem}
                        className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        提交当前 Stem 的评估报告
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-700/50 flex flex-col justify-center items-center text-center">
                    <div className="w-full h-64">
                      <h4 className="text-xs font-bold text-slate-500 uppercase mb-4">
                        实时评分统计 (Radar)
                      </h4>
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart
                          cx="50%"
                          cy="50%"
                          outerRadius="80%"
                          data={chartData}
                        >
                          <PolarGrid stroke="#334155" />
                          <PolarAngleAxis
                            dataKey="subject"
                            tick={{ fill: "#94a3b8", fontSize: 10 }}
                          />
                          <PolarRadiusAxis
                            angle={30}
                            domain={[0, 100]}
                            tick={false}
                            axisLine={false}
                          />
                          <Radar
                            name="Demucs v4"
                            dataKey="Demucs"
                            stroke="#06b6d4"
                            fill="#06b6d4"
                            fillOpacity={0.3}
                          />
                          <Radar
                            name="Spleeter"
                            dataKey="Spleeter"
                            stroke="#8b5cf6"
                            fill="#8b5cf6"
                            fillOpacity={0.3}
                          />
                          <Legend wrapperStyle={{ fontSize: "10px" }} />
                          <RechartsTooltip
                            contentStyle={{
                              backgroundColor: "#0f172a",
                              borderColor: "#334155",
                              color: "#fff",
                            }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Statistics Page View */}
        {currentView === "stats" && (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-slate-800 rounded-xl p-8 border border-slate-700">
              <h2 className="text-2xl font-bold mb-2">全站算法评估排行榜</h2>
              <p className="text-slate-400">
                基于 {backendStats.reduce((sum, s) => sum + (s.total_scores || 0), 0) || communityStats.length} 份专家评估报告生成的汇总数据。
                {backendStats.length > 0 && (
                  <span className="ml-2 text-cyan-400">
                    （{backendStats.reduce((sum, s) => sum + (s.unique_experts || 0), 0)} 位专家参与）
                  </span>
                )}
              </p>
              {loadingStats && (
                <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
                  <Activity size={12} className="animate-pulse" />
                  正在加载统计数据...
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Cards */}
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-xl border border-slate-700 relative overflow-hidden">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-cyan-500/20 rounded-full blur-2xl"></div>
                <h3 className="text-slate-400 text-sm font-bold uppercase">
                  最佳人声分离
                </h3>
                <p className="text-3xl font-bold text-white mt-2">Demucs v4</p>
                <div className="mt-4 flex items-center text-emerald-400 text-sm gap-1">
                  <CheckCircle size={14} /> 98% 专家推荐
                </div>
              </div>
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-xl border border-slate-700 relative overflow-hidden">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-purple-500/20 rounded-full blur-2xl"></div>
                <h3 className="text-slate-400 text-sm font-bold uppercase">
                  最快推理速度
                </h3>
                <p className="text-3xl font-bold text-white mt-2">Spleeter</p>
                <div className="mt-4 flex items-center text-blue-400 text-sm gap-1">
                  <Activity size={14} /> 实时处理能力强
                </div>
              </div>
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-xl border border-slate-700 relative overflow-hidden">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-orange-500/20 rounded-full blur-2xl"></div>
                <h3 className="text-slate-400 text-sm font-bold uppercase">
                  待改进算法
                </h3>
                <p className="text-3xl font-bold text-white mt-2">OpenUnmix</p>
                <div className="mt-4 flex items-center text-orange-400 text-sm gap-1">
                  <AlertTriangle size={14} /> 高频部分丢失严重
                </div>
              </div>
            </div>

            {/* 按算法 + Stem 的主观评分统计 - 使用后端数据 */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h3 className="font-bold text-white mb-4">按 Stem 维度的主观评分统计（社区数据）</h3>
              <p className="text-xs text-slate-400 mb-4">
                这里按「算法 + 单一声源（stem）」分别统计了 Quality / Interference /
                Artifacts 的平均得分，便于对比不同源上的表现差异。数据来自所有专家的集体评估。
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="py-2 pr-4">Algorithm</th>
                      <th className="py-2 pr-4">Stem</th>
                      <th className="py-2 pr-4 text-right">Quality</th>
                      <th className="py-2 pr-4 text-right">Interference</th>
                      <th className="py-2 pr-4 text-right">Artifacts</th>
                      <th className="py-2 pr-4 text-right">Samples</th>
                      <th className="py-2 pr-4 text-right">Experts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backendStats.length === 0 && stemStats.length === 0 ? (
                      <tr>
                        <td
                          className="py-4 text-center text-slate-500"
                          colSpan={7}
                        >
                          {loadingStats ? "正在加载数据..." : "暂无评分数据，请在工作台中对不同 stem 提交评估。"}
                        </td>
                      </tr>
                    ) : (
                      (backendStats.length > 0 ? backendStats : stemStats.map(s => ({
                        algorithm: s.algorithm,
                        stem_name: s.stemName,
                        avg_quality: s.avgQuality,
                        avg_interference: s.avgInterference,
                        avg_artifacts: s.avgArtifacts,
                        total_scores: s.count,
                        unique_experts: 0,
                      }))).map((row) => (
                        <tr
                          key={`${row.algorithm}-${row.stem_name || row.stemName}`}
                          className="border-b border-slate-800 hover:bg-slate-900/60 transition"
                        >
                          <td className="py-1 pr-4 text-slate-200">
                            {row.algorithm}
                          </td>
                          <td className="py-1 pr-4 text-slate-300">
                            {row.stem_name || row.stemName || "ALL"}
                          </td>
                          <td className="py-1 pr-4 text-right text-emerald-400 font-mono">
                            {((row.avg_quality ?? row.avgQuality) ?? 0).toFixed(1)}
                          </td>
                          <td className="py-1 pr-4 text-right text-cyan-400 font-mono">
                            {((row.avg_interference ?? row.avgInterference) ?? 0).toFixed(1)}
                          </td>
                          <td className="py-1 pr-4 text-right text-orange-400 font-mono">
                            {((row.avg_artifacts ?? row.avgArtifacts) ?? 0).toFixed(1)}
                          </td>
                          <td className="py-1 pr-4 text-right text-slate-400 font-mono">
                            {row.total_scores || row.count || 0}
                          </td>
                          <td className="py-1 pr-4 text-right text-purple-400 font-mono">
                            {row.unique_experts || "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 算法在四个Stem上的表现对比图表 */}
            {algorithmComparison.length > 0 && (
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h3 className="font-bold text-white mb-4">算法在不同 Stem 上的表现对比</h3>
                <p className="text-xs text-slate-400 mb-6">
                  展示各算法在 Vocals、Drums、Bass、Other 四个声源上的平均质量评分
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {algorithmComparison.map((algo) => {
                    const stemNames = ["Vocals", "Drums", "Bass", "Other"];
                    const chartData = stemNames.map((stemName) => {
                      const stemData = algo.stem_breakdown.find(
                        (s) => s.stem_name === stemName
                      );
                      return {
                        stem: stemName,
                        quality: stemData?.avg_quality || 0,
                        interference: stemData?.avg_interference || 0,
                        artifacts: 100 - (stemData?.avg_artifacts || 0), // 转换为正向指标
                      };
                    });

                    const colors = {
                      "Demucs v4": "#06b6d4",
                      "Spleeter": "#8b5cf6",
                      "OpenUnmix": "#f59e0b",
                      "BandSplitRNN": "#10b981",
                    };

                    return (
                      <div key={algo.algorithm} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                        <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: colors[algo.algorithm] || "#06b6d4" }}
                          />
                          {algo.algorithm}
                        </h4>
                        <p className="text-xs text-slate-400 mb-4">
                          总体评分: Quality {(algo.overall_avg_quality ?? 0).toFixed(1)} | 
                          Interference {(algo.overall_avg_interference ?? 0).toFixed(1)} | 
                          Artifacts {(algo.overall_avg_artifacts ?? 0).toFixed(1)}
                        </p>
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="stem" stroke="#94a3b8" fontSize={10} />
                            <YAxis stroke="#94a3b8" domain={[0, 100]} />
                            <RechartsTooltip
                              contentStyle={{
                                backgroundColor: "#0f172a",
                                borderColor: "#334155",
                                color: "#fff",
                              }}
                            />
                            <Legend />
                            <Bar dataKey="quality" fill="#10b981" name="Quality" />
                            <Bar dataKey="interference" fill="#06b6d4" name="Interference" />
                            <Bar dataKey="artifacts" fill="#f59e0b" name="Artifacts" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 h-96">
              <h3 className="font-bold text-white mb-6">
                评分趋势分析 (MOS Score)
              </h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={[
                    { name: "Jan", Demucs: 65, Spleeter: 60 },
                    { name: "Feb", Demucs: 70, Spleeter: 62 },
                    { name: "Mar", Demucs: 78, Spleeter: 61 },
                    { name: "Apr", Demucs: 85, Spleeter: 63 },
                    { name: "May", Demucs: 88, Spleeter: 65 },
                    { name: "Jun", Demucs: 92, Spleeter: 64 },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="Demucs"
                    stroke="#06b6d4"
                    strokeWidth={3}
                  />
                  <Line
                    type="monotone"
                    dataKey="Spleeter"
                    stroke="#8b5cf6"
                    strokeWidth={3}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Community Comments Page View */}
        {currentView === "audio_resources" && (
          <AudioResources token={authToken} />
        )}

        {currentView === "comments" && (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-slate-800 rounded-xl p-8 border border-slate-700">
              <h2 className="text-2xl font-bold mb-2">社区评论板块</h2>
              <p className="text-slate-400">
                专家们对不同算法在四个 Stem 上的打分效果进行讨论和交流
              </p>
            </div>

            {/* 算法和Stem选择器 */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <MessageCircle size={18} />
                筛选讨论
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 mb-2 block">算法</label>
                  <select className="w-full px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
                    <option value="">全部算法</option>
                    {ALGORITHMS.map((algo) => (
                      <option key={algo} value={algo}>
                        {algo}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-2 block">Stem</label>
                  <select className="w-full px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
                    <option value="">全部 Stem</option>
                    <option value="Vocals">Vocals</option>
                    <option value="Drums">Drums</option>
                    <option value="Bass">Bass</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 统计概览卡片 */}
            {backendStats.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {ALGORITHMS.slice(0, 4).map((algo) => {
                  const algoStats = backendStats.filter((s) => s.algorithm === algo);
                  const totalScores = algoStats.reduce((sum, s) => sum + (s.total_scores || 0), 0);
                  const avgQuality = algoStats.length > 0
                    ? algoStats.reduce((sum, s) => sum + (s.avg_quality || 0), 0) / algoStats.length
                    : 0;
                  
                  return (
                    <div
                      key={algo}
                      className="bg-slate-800 rounded-xl p-4 border border-slate-700 hover:border-cyan-500/50 transition"
                    >
                      <h4 className="text-sm font-bold text-slate-300 mb-2 truncate">{algo}</h4>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">平均质量</span>
                          <span className="text-emerald-400 font-mono">{avgQuality.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">评分数量</span>
                          <span className="text-cyan-400 font-mono">{totalScores}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 评论列表 */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h3 className="font-bold text-white mb-4">专家讨论</h3>
              <div className="space-y-4">
                {backendStats.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <MessageCircle size={48} className="mx-auto mb-4 opacity-50" />
                    <p>暂无评论数据</p>
                    <p className="text-xs mt-2">专家们可以在工作台提交评分后，系统会自动生成统计结果</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {algorithmComparison.map((algo) => (
                      <div
                        key={algo.algorithm}
                        className="bg-slate-900/50 rounded-lg p-4 border border-slate-700"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="font-bold text-white flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-cyan-400" />
                              {algo.algorithm}
                            </h4>
                            <p className="text-xs text-slate-400 mt-1">
                              总体评分: {(algo.overall_avg_quality ?? 0).toFixed(1)} / 100 | 
                              共 {algo.total_scores} 份评分
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 space-y-2">
                          <p className="text-xs text-slate-400 font-bold mb-2">各 Stem 表现：</p>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {algo.stem_breakdown.map((stem) => (
                              <div
                                key={stem.stem_name}
                                className="bg-slate-800 rounded p-2 border border-slate-700"
                              >
                                <div className="text-xs font-bold text-slate-300 mb-1">
                                  {stem.stem_name}
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-500">质量</span>
                                    <span className="text-emerald-400">{(stem.avg_quality ?? 0).toFixed(1)}</span>
                                  </div>
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-500">干扰</span>
                                    <span className="text-cyan-400">{(stem.avg_interference ?? 0).toFixed(1)}</span>
                                  </div>
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-500">伪影</span>
                                    <span className="text-orange-400">{(stem.avg_artifacts ?? 0).toFixed(1)}</span>
                                  </div>
                                  <div className="text-[10px] text-slate-600 mt-1">
                                    {stem.total_scores} 份评分
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 数据说明 */}
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <p className="text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-300">说明：</strong>
                本页面展示的是所有专家对不同算法在四个 Stem（Vocals、Drums、Bass、Other）上的打分统计结果。
                数据实时更新，每30秒自动刷新。您可以在工作台提交自己的评分，参与社区评估。
              </p>
            </div>
          </div>
        )}
      </main>

      {/* 通知中心 */}
      {showNotificationCenter && (
        <NotificationCenter
          token={authToken}
          onClose={() => {
            setShowNotificationCenter(false);
            fetchUnreadNotificationCount();
          }}
        />
      )}

      {/* 音频资源选择器 */}
      {showResourceSelector && (
        <AudioResourceSelector
          token={authToken}
          title={resourceSelectorType === 'input' ? '选择输入音频源' : '选择金标准参考音轨'}
          onSelect={handleResourceSelect}
          onClose={() => {
            setShowResourceSelector(false);
            setResourceSelectorType(null);
          }}
        />
      )}
    </div>
  );
}
