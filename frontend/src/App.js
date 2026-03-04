import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import StemPlayer from "./StemPlayer";
import AuthPage from "./AuthPage";
import AudioResources from "./AudioResources";
import AudioResourceSelector from "./AudioResourceSelector";
import AdminDashboard from "./AdminDashboard";
import NotificationCenter from "./NotificationCenter";
import ExpertMessageDialog from "./ExpertMessageDialog";
import UserManual from "./UserManual";
import { useToast } from "./Toast";
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
  Maximize2,
  Minimize2,
  BarChart2,
  Award,
  Music,
  User,
  LogOut,
  ChevronRight,
  ChevronDown,
  Headphones,
  MessageCircle,
  Bell,
  Mail,
  Lock,
  Upload as UploadIcon,
  X as CloseIcon,
  Clock,
  RotateCcw,
  BookOpen,
  Users,
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

// --- Simple shareable routes (no full <Routes> needed; we sync view <-> path) ---
const VIEW_TO_PATH = {
  dashboard: "/",
  stats: "/stats",
  audio_resources: "/audio-resources",
  comments: "/comments",
  history: "/history",
  manual: "/manual",
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

// --- Components ---

// 1. 用户面板组件（仅用于普通用户界面，管理员不会看到）
const AuthPanel = ({ user, onLogout, onClickUser }) => {
  if (!user) return null;

  const getRoleBadge = (role) => {
    const badges = {
      expert: { color: "bg-purple-500/20 text-purple-300", label: "专家" },
      admin: { color: "bg-red-500/20 text-red-300", label: "管理员" },
    };
    return badges[role] || badges.expert;
  };

  const badge = getRoleBadge(user.role);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClickUser}
        className="flex items-center gap-2.5 bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-cyan-500/70 hover:bg-slate-800/80 transition cursor-pointer flex-shrink-0"
        title="点击查看和编辑个人信息"
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt={user.username}
            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white text-xs flex-shrink-0">
            {user.username.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="text-sm min-w-0 hidden md:block">
          <div className="flex items-center gap-1.5">
            <p className="text-slate-300 font-medium truncate">{user.username}</p>
            <span className={`px-2 py-0.5 text-xs rounded whitespace-nowrap flex-shrink-0 ${badge.color}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-emerald-400 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0"></span>
            在线
          </p>
        </div>
      </button>
      <button
        onClick={onLogout}
        className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition flex-shrink-0"
        title="登出"
      >
        <LogOut size={18} />
      </button>
    </div>
  );
};

// 1.1 用户信息编辑弹窗（点击用户框时出现）
const UserProfileDialog = ({ user, token, onClose, onUserUpdated }) => {
  const { showError, showSuccess } = useToast();
  const [username, setUsername] = React.useState(user?.username || "");
  const [avatarPreview, setAvatarPreview] = React.useState(user?.avatar_url || null);
  const [avatarFile, setAvatarFile] = React.useState(null);
  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const fileInputRef = React.useRef(null);

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const uploadAvatar = async () => {
    if (!avatarFile) return user?.avatar_url || null;
    const formData = new FormData();
    formData.append("file", avatarFile);
    const resp = await fetch(`${API_BASE}/api/auth/upload_avatar`, {
      method: "POST",
      body: formData,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || "头像上传失败");
    }
    const data = await resp.json();
    return data.avatar_url;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim()) {
      showError("用户名不能为空");
      return;
    }
    if (newPassword || oldPassword || confirmPassword) {
      if (!oldPassword || !newPassword || !confirmPassword) {
        showError("修改密码时请填写旧密码、新密码和确认密码");
        return;
      }
      if (newPassword !== confirmPassword) {
        showError("两次输入的新密码不一致");
        return;
      }
    }

    setSubmitting(true);
    try {
      let avatarUrl = user?.avatar_url || null;
      if (avatarFile) {
        avatarUrl = await uploadAvatar();
      }

      const body = {
        username: username.trim() !== user.username ? username.trim() : undefined,
        avatar_url: avatarUrl !== user.avatar_url ? avatarUrl : undefined,
      };

      if (newPassword || oldPassword || confirmPassword) {
        body.old_password = oldPassword;
        body.new_password = newPassword;
      }

      // 去除未修改字段
      const payload = Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== undefined && v !== null),
      );

      const resp = await fetch(`${API_BASE}/api/auth/me`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        let msg = "更新失败";
        try {
          const errData = await resp.json();
          msg = errData.detail || errData.message || JSON.stringify(errData);
        } catch {
          const text = await resp.text();
          msg = text || msg;
        }
        throw new Error(msg);
      }

      const updatedUser = await resp.json();
      showSuccess("个人信息已更新");
      if (onUserUpdated) onUserUpdated(updatedUser);
    } catch (err) {
      const msg = err.message || "更新失败";
      if (msg.includes("用户名已被使用")) {
        showError("该用户名已被其他用户占用，请更换一个新的用户名");
      } else {
        showError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-auto">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 rounded-2xl shadow-2xl border border-slate-700/80 max-w-lg w-full mx-4 p-6 animate-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center">
              <User size={22} className="text-cyan-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">个人信息</h2>
              <p className="text-xs text-slate-400">查看并更新用户名、头像和登录密码</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white hover:bg-slate-800 rounded-full p-1.5 transition"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* 基本信息 */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                用户名
              </label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="请输入用户名"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  邮箱
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type="email"
                    value={user.email}
                    disabled
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-400 cursor-not-allowed"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  角色
                </label>
                <div className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300">
                  {user.role === "admin" ? "管理员" : "专家"}
                </div>
              </div>
            </div>
          </div>

          {/* 头像 */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              头像
            </label>
            <div className="flex items-center gap-4">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt="avatar"
                  className="w-14 h-14 rounded-full object-cover border-2 border-cyan-500/70"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white text-sm">
                  {username.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-xs text-slate-200 hover:bg-slate-700 hover:border-cyan-500 transition"
                >
                  <UploadIcon size={14} />
                  更换头像
                </button>
                <p className="text-[11px] text-slate-500">
                  支持常见图片格式，建议使用正方形图片以获得更好显示效果。
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>
          </div>

          {/* 修改密码 */}
          <div className="space-y-3 border-t border-slate-700 pt-4">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Lock size={14} className="text-slate-500" />
              <span>如需修改密码，请同时填写以下三项</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  旧密码
                </label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="当前登录密码"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  新密码
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="至少 6 位"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  确认新密码
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="再次输入新密码"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] text-slate-500">
              提示：密码仅用于本系统登录，请勿与其他网站使用相同密码。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 transition"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-xs rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white font-medium shadow-lg shadow-cyan-600/30 transition"
              >
                {submitting ? "保存中..." : "保存修改"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

// 2. 波形/频谱可视化组件 (核心难点实现)
// eslint-disable-next-line no-unused-vars
const WaveformComparator = ({
  groundTruth,
  goldWave,
  separated,
  // 说明：新的设计里只做“两路波形对比”（参考 vs 分离），不再做 Time Domain Difference Overlay
  // showMixture/showGold 用于选择“参考波形”来源（原始混合音 vs 金标准），一次只展示其中一路。
  showMixture = true,
  showGold = true,
  showSeparated = true,
  autoGain = true,
  yZoom = 1.0,
  errorThreshold = 0.15,
  heightPx = 360,
  viewRange,
  onViewRangeChange,
  playbackState = { currentTime: 0, duration: 0, playing: false, seek: null },
}) => {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(null); // 0~1 归一化
  const [dragCurrentX, setDragCurrentX] = useState(null); // 0~1 归一化
  const [scrubbing, setScrubbing] = useState(false); // 是否正在拖动播放进度线
  const [scrubPosition, setScrubPosition] = useState(null); // 拖动时的临时位置
  const [hoverX, setHoverX] = useState(null); // 0~1 归一化（视窗内）
  const [layout, setLayout] = useState({ w: 800, h: 256 });

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const unpackWave = useCallback((input) => {
    // 支持两种输入：
    // 1) 旧：number[]（中线）
    // 2) 新：{ min: number[], max: number[] }（包络）
    if (Array.isArray(input)) {
      return { mid: input, min: null, max: null };
    }
    if (input && typeof input === "object") {
      const wMin = input.min;
      const wMax = input.max;
      if (Array.isArray(wMin) && Array.isArray(wMax) && wMin.length && wMax.length) {
        // 为了 diff/hover 等逻辑，生成一个中线（不改变原始 min/max）
        const n = Math.min(wMin.length, wMax.length);
        const mid = new Array(n);
        for (let i = 0; i < n; i += 1) {
          const a = typeof wMin[i] === "number" && isFinite(wMin[i]) ? wMin[i] : 0;
          const b = typeof wMax[i] === "number" && isFinite(wMax[i]) ? wMax[i] : 0;
          mid[i] = (a + b) * 0.5;
        }
        return { mid, min: wMin, max: wMax };
      }
    }
    return { mid: [], min: null, max: null };
  }, []);
  const getValAt = useCallback((arr, pos01) => {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    if (arr.length === 1) return arr[0] || 0;
    const p = clamp01(pos01);
    const idx = Math.floor(p * (arr.length - 1));
    const v = arr[idx];
    return typeof v === "number" && isFinite(v) ? v : 0;
  }, []);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries?.[0];
      const rect = entry?.contentRect;
      if (!rect) return;
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      setLayout((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = layout.w || canvas.clientWidth || 800;
    const cssHeight = layout.h || canvas.clientHeight || 256;
    const width = cssWidth;
    const height = cssHeight;

    // 设置真实像素尺寸（更清晰）
    const pxW = Math.max(1, Math.floor(cssWidth * dpr));
    const pxH = Math.max(1, Math.floor(cssHeight * dpr));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 清空
    ctx.clearRect(0, 0, width, height);

    // 背景网格
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gridX = Math.max(40, Math.floor(width / 16));
    const gridY = Math.max(28, Math.floor(height / 8));
    for (let x = 0; x < width; x += gridX) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += gridY) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // 垂直布局：上半段绘制“参考波形”(Reference)，下半段绘制“分离结果”(Separated)
    const refCenterY = height * 0.25;
    const sepCenterY = height * 0.75;
    const vrStart = Math.max(0, Math.min(1, viewRange?.start ?? 0));
    const vrEnd = Math.max(vrStart, Math.min(1, viewRange?.end ?? 1));
    const span = Math.max(0.0001, vrEnd - vrStart);

    const mixW = unpackWave(groundTruth);
    const sepW = unpackWave(separated);
    const goldW = unpackWave(goldWave);

    const mixture = Array.isArray(mixW.mid) ? mixW.mid : [];
    const sep = Array.isArray(sepW.mid) ? sepW.mid : [];
    const gold = Array.isArray(goldW.mid) ? goldW.mid : [];

    const getPeakAbsInView = (arr) => {
      if (!Array.isArray(arr) || arr.length === 0) return 0;
      if (arr.length === 1) return Math.abs(arr[0] || 0);
      const s = Math.max(0, Math.min(arr.length - 1, Math.floor(vrStart * (arr.length - 1))));
      const e = Math.max(s, Math.min(arr.length - 1, Math.ceil(vrEnd * (arr.length - 1))));
      let peak = 0;
      for (let i = s; i <= e; i += 1) {
        const v = arr[i];
        if (typeof v !== "number" || !isFinite(v)) continue;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
      return peak;
    };

    // 选择参考波形：优先使用 Gold，其次是 Mixture
    const refWaveArr = showGold && gold.length ? gold : mixture;

    // 为参考与分离两条轨道分别画“零线”
    ctx.strokeStyle = "rgba(148, 163, 184, 0.35)"; // slate-400
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, refCenterY);
    ctx.lineTo(width, refCenterY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, sepCenterY);
    ctx.lineTo(width, sepCenterY);
    ctx.stroke();

    // 显示缩放：autoGain 会基于“当前视窗 + 当前可见曲线”计算统一放大倍数（仅显示，不改数据）
    let baseScaleY = (height * 0.38);
    if (autoGain) {
      let peak = 0;
      peak = Math.max(peak, getPeakAbsInView(refWaveArr));
      if (showSeparated) peak = Math.max(peak, getPeakAbsInView(sep));
      const denom = peak > 1e-6 ? peak : 1.0;
      baseScaleY = (height * 0.44) / denom; // 留边距
    }
    const safeZoom = typeof yZoom === "number" && isFinite(yZoom) ? Math.max(0.1, Math.min(10, yZoom)) : 1.0;
    const scaleY = baseScaleY * safeZoom;

    const drawEnvelopeOrLine = (centerY, w, rgbaStroke, rgbaFill) => {
      const midArr = w?.mid;
      const minArr = w?.min;
      const maxArr = w?.max;
      if (!Array.isArray(midArr) || midArr.length === 0) return;

      // 如果有 min/max，则画“包络填充 + 边界线”
      if (Array.isArray(minArr) && Array.isArray(maxArr) && minArr.length && maxArr.length) {
        ctx.beginPath();
        ctx.fillStyle = rgbaFill;
        // 上边界：max
        for (let i = 0; i < width; i += 1) {
          const pos = vrStart + (i / width) * span;
          const v = getValAt(maxArr, pos);
          if (i === 0) ctx.moveTo(i, centerY + v * scaleY);
          else ctx.lineTo(i, centerY + v * scaleY);
        }
        // 下边界：min（反向闭合）
        for (let i = width - 1; i >= 0; i -= 1) {
          const pos = vrStart + (i / width) * span;
          const v = getValAt(minArr, pos);
          ctx.lineTo(i, centerY + v * scaleY);
        }
        ctx.closePath();
        ctx.fill();

        // 边界线（更清晰）
        ctx.strokeStyle = rgbaStroke;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < width; i += 1) {
          const pos = vrStart + (i / width) * span;
          const v = getValAt(maxArr, pos);
          if (i === 0) ctx.moveTo(i, centerY + v * scaleY);
          else ctx.lineTo(i, centerY + v * scaleY);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < width; i += 1) {
          const pos = vrStart + (i / width) * span;
          const v = getValAt(minArr, pos);
          if (i === 0) ctx.moveTo(i, centerY + v * scaleY);
          else ctx.lineTo(i, centerY + v * scaleY);
        }
        ctx.stroke();
        return;
      }

      // 否则退化为中线（旧逻辑）
      ctx.beginPath();
      ctx.strokeStyle = rgbaStroke;
      ctx.lineWidth = 2;
      for (let i = 0; i < width; i += 1) {
        const pos = vrStart + (i / width) * span;
        const val = getValAt(midArr, pos);
        if (i === 0) ctx.moveTo(i, centerY + val * scaleY);
        else ctx.lineTo(i, centerY + val * scaleY);
      }
      ctx.stroke();
    };

    // --- 绘制参考波形（上半段） ---
    if (Array.isArray(refWaveArr) && refWaveArr.length) {
      const refWave =
        showGold && gold.length
          ? goldW
          : mixW;
      drawEnvelopeOrLine(
        refCenterY,
        refWave,
        showGold && gold.length
          ? "rgba(168, 85, 247, 0.88)" // Gold: purple
          : "rgba(16, 185, 129, 0.88)", // Mixture: emerald
        showGold && gold.length
          ? "rgba(168, 85, 247, 0.16)"
          : "rgba(16, 185, 129, 0.16)",
      );
    }

    // --- 绘制分离结果（下半段） ---
    if (showSeparated && sep.length) {
      drawEnvelopeOrLine(
        sepCenterY,
        sepW,
        "rgba(6, 182, 212, 0.9)", // cyan
        "rgba(6, 182, 212, 0.14)",
      );
    }

    // Hover 指示线（更容易在两路波形上读位置）
    if (hoverX !== null && isFinite(hoverX)) {
      const x = Math.max(0, Math.min(1, hoverX)) * width;
      ctx.strokeStyle = "rgba(226, 232, 240, 0.35)"; // slate-200
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
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
  }, [
    groundTruth,
    goldWave,
    separated,
    showMixture,
    showGold,
    showSeparated,
    autoGain,
    yZoom,
    viewRange,
    playbackState,
    scrubbing,
    scrubPosition,
    hoverX,
    layout,
    getValAt,
    unpackWave,
  ]);

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
    // 非拖拽/非 scrub 时也记录 hover，方便读取
    if (!dragging && !scrubbing) {
      setHoverX(getNormalizedX(e));
    }
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
    setHoverX(null);
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
      ref={wrapperRef}
      className="relative w-full bg-slate-950 rounded-lg overflow-hidden border border-slate-700 shadow-inner"
      style={{
        height: `${Math.max(220, Number(heightPx) || 360)}px`,
        cursor: scrubbing ? "grabbing" : dragging ? "crosshair" : "pointer",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full object-cover"
      />

      {/* Hover 读数（便于精确对比） */}
      {hoverX !== null && isFinite(hoverX) && (
        (() => {
          const vrStart = clamp01(viewRange?.start ?? 0);
          const vrEnd = Math.max(vrStart, clamp01(viewRange?.end ?? 1));
          const span = Math.max(0.0001, vrEnd - vrStart);
          const globalPos = vrStart + clamp01(hoverX) * span; // 0~1

          const mixture = Array.isArray(groundTruth) ? groundTruth : [];
          const sep = Array.isArray(separated) ? separated : [];
          const gold = Array.isArray(goldWave) ? goldWave : [];
          const diffBase = showGold && gold.length ? gold : mixture;

          const t = playbackState?.duration > 0 ? globalPos * playbackState.duration : null;
          const fmt = (v) => (typeof v === "number" && isFinite(v) ? v.toFixed(3) : "N/A");

          const baseVal = getValAt(diffBase, globalPos);
          const sepVal = getValAt(sep, globalPos);
          const diff = Math.abs(baseVal - sepVal);

          return (
            <div className="absolute top-2 left-2 pointer-events-none select-none">
              <div className="bg-slate-900/70 border border-slate-700/60 backdrop-blur-sm rounded-lg px-3 py-2 text-[11px] font-mono text-slate-200 shadow-lg">
                <div className="flex items-center gap-3">
                  <span className="text-slate-400">pos</span>
                  <span>{(globalPos * 100).toFixed(1)}%</span>
                  {t !== null && (
                    <>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-300">{t.toFixed(2)}s</span>
                    </>
                  )}
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400">th</span>
                  <span className="text-red-300">{Number(errorThreshold).toFixed(2)}</span>
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <span className="text-purple-300">{showGold && gold.length ? "Gold" : "Mix"}</span>
                  <span>{fmt(baseVal)}</span>
                  <span className="text-cyan-300">Alg</span>
                  <span>{fmt(sepVal)}</span>
                  <span className="text-red-300">|diff|</span>
                  <span className={diff > errorThreshold ? "text-red-200" : "text-slate-300"}>
                    {diff.toFixed(3)}
                  </span>
                </div>
              </div>
            </div>
          );
        })()
      )}

      {/* 选中区域可视化（仍然用于统一时间缩放；两路波形共享同一时间轴） */}
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

// 频率分析图组件：对比标准音频和分离音频的频率响应曲线
const FrequencyAnalysisPlot = ({
  isActive,
  originalFrequencyResponse,
  separatedFrequencyResponse,
  sampleRate = 44100,
  nFreqBins = 128,
}) => {
  // 计算频率轴数据
  const frequencyData = useMemo(() => {
    // 检查数据是否有效
    const hasOriginal = Array.isArray(originalFrequencyResponse) && originalFrequencyResponse.length > 0;
    const hasSeparated = Array.isArray(separatedFrequencyResponse) && separatedFrequencyResponse.length > 0;
    
    // 调试信息
    if (isActive && (!hasOriginal && !hasSeparated)) {
      console.log('[FrequencyAnalysisPlot] 数据检查:', {
        isActive,
        hasOriginal,
        hasSeparated,
        originalLen: originalFrequencyResponse?.length,
        separatedLen: separatedFrequencyResponse?.length,
        originalType: typeof originalFrequencyResponse,
        separatedType: typeof separatedFrequencyResponse,
      });
    }
    
    if (!isActive || (!hasOriginal && !hasSeparated)) {
      return [];
    }

    // 使用实际的数据长度，而不是maxBins
    const originalLen = hasOriginal ? originalFrequencyResponse.length : 0;
    const separatedLen = hasSeparated ? separatedFrequencyResponse.length : 0;
    const maxBins = Math.max(originalLen, separatedLen);
    
    if (maxBins === 0) {
      return [];
    }

    const nyquist = sampleRate / 2;
    
    // 根据频率bin索引计算频率（线性分布，从0到nyquist）
    // 注意：后端已经将频率响应降采样到spec_freq_bins，所以这里直接使用数据长度
    const data = Array.from({ length: maxBins }, (_, i) => {
      // 频率bin索引对应的频率：i / (maxBins - 1) * nyquist
      // 对于rfft，频率范围是0到nyquist，共maxBins个点
      // 当maxBins=1时，频率为0；否则线性分布
      let freq = maxBins > 1 ? (i / (maxBins - 1)) * nyquist : 0;
      // 确保频率不为0（避免对数刻度问题），最小值为0.1Hz
      // 但保留0Hz作为DC分量（如果需要的话，可以跳过）
      const safeFreq = freq === 0 ? 0.1 : freq;
      const originalValue = hasOriginal && i < originalLen ? originalFrequencyResponse[i] : null;
      const separatedValue = hasSeparated && i < separatedLen ? separatedFrequencyResponse[i] : null;
      
      // 只包含至少有一个有效值的数据点
      if (originalValue === null && separatedValue === null) {
        return null;
      }
      
      return {
        frequency: safeFreq,
        original: originalValue,
        separated: separatedValue,
      };
    }).filter((d) => d !== null);

    if (data.length > 0) {
      console.log('[FrequencyAnalysisPlot] 生成数据点:', {
        dataPoints: data.length,
        firstPoint: data[0],
        lastPoint: data[data.length - 1],
        sampleRate,
        maxBins,
      });
    }

    return data;
  }, [isActive, originalFrequencyResponse, separatedFrequencyResponse, sampleRate]);

  if (!isActive || frequencyData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-500 bg-slate-900/50 rounded-lg border border-slate-700/50">
        <span>
          频率分析数据不可用
          {!isActive && " (未激活)"}
          {isActive && frequencyData.length === 0 && " (数据为空)"}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/50 rounded-lg border border-slate-700/50 p-4">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={frequencyData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="frequency"
              type="number"
              scale="log"
              domain={['auto', 'auto']}
              label={{ value: '频率 (Hz)', position: 'insideBottom', offset: -5, style: { fill: '#94a3b8' } }}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickFormatter={(value) => {
                if (!isFinite(value) || value <= 0) return '0';
                if (value < 1) return value.toFixed(2);
                if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
                return value.toFixed(0);
              }}
            />
            <YAxis
              label={{ value: '幅度 (dB)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8' } }}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #475569',
                borderRadius: '6px',
                color: '#e2e8f0',
              }}
              formatter={(value, name) => {
                if (value === null || value === undefined) return ['N/A', name];
                return [`${value.toFixed(2)} dB`, name];
              }}
              labelFormatter={(label) => `频率: ${label >= 1000 ? `${(label / 1000).toFixed(2)}k` : label.toFixed(0)} Hz`}
            />
            <Legend
              wrapperStyle={{ paddingTop: '10px' }}
              iconType="line"
              formatter={(value) => {
                if (value === 'original') return '标准音频';
                if (value === 'separated') return '分离音频';
                return value;
              }}
            />
            <Line
              type="monotone"
              dataKey="original"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              name="original"
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="separated"
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              name="separated"
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// eslint-disable-next-line no-unused-vars
const SpectrumComparator = ({
  isActive,
  originalSpectrumData,
  separatedSpectrumData,
  viewRange,
  onViewRangeChange,
}) => {
  const originalCanvasRef = useRef(null);
  const separatedCanvasRef = useRef(null);
  const diffCanvasRef = useRef(null);

  const drawSpectrogram = useCallback((canvas, data, mode = "normal") => {
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

        let r;
        let g;
        let b;

        if (mode === "diff") {
          // 差分视图：更偏红的热力图，高误差区域一眼可见
          r = Math.floor(255 * v);
          g = Math.floor(80 * Math.max(0, v - 0.15));
          b = Math.floor(60 * (1 - v));
        } else {
          // 默认视图：简化的 inferno-ish 渐变
          r = Math.floor(255 * Math.min(1, v * 1.4));
          g = Math.floor(255 * Math.min(1, Math.max(0, (v - 0.25) * 1.3)));
          b = Math.floor(255 * Math.max(0, 1 - v * 1.2));
        }

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

  useEffect(() => {
    if (!isActive) return;
    if (
      !Array.isArray(originalSpectrumData) ||
      !Array.isArray(separatedSpectrumData) ||
      originalSpectrumData.length === 0 ||
      separatedSpectrumData.length === 0
    ) {
      return;
    }
    const fBins = Math.min(originalSpectrumData.length, separatedSpectrumData.length);
    const tBins = Array.isArray(originalSpectrumData[0])
      ? Math.min(
          originalSpectrumData[0].length,
          Array.isArray(separatedSpectrumData[0]) ? separatedSpectrumData[0].length : 0,
        )
      : 0;
    if (!tBins) return;

    // 构造 |Mix - Alg| 差分频谱矩阵，值域 [0,1]
    const diff = new Array(fBins);
    let globalMax = 1e-8;
    for (let f = 0; f < fBins; f += 1) {
      const rowA = originalSpectrumData[f] || [];
      const rowB = separatedSpectrumData[f] || [];
      const rowOut = new Array(tBins);
      for (let t = 0; t < tBins; t += 1) {
        const a = rowA[t] ?? 0;
        const b = rowB[t] ?? 0;
        const v = Math.abs(a - b);
        rowOut[t] = v;
        if (v > globalMax) globalMax = v;
      }
      diff[f] = rowOut;
    }
    // 归一化到 [0,1]，防止极少数点把整体推得太暗
    const normDiff = diff.map((row) =>
      row.map((v) => (globalMax > 0 ? Math.min(1, v / globalMax) : 0)),
    );

    drawSpectrogram(diffCanvasRef.current, normDiff, "diff");
  }, [isActive, originalSpectrumData, separatedSpectrumData, viewRange, drawSpectrogram]);

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

  // 频带误差（低/中/高）基于原始 vs 分离频谱的差分粗略估计
  let lowErr = null;
  let midErr = null;
  let highErr = null;
  if (
    Array.isArray(originalSpectrumData) &&
    Array.isArray(separatedSpectrumData) &&
    originalSpectrumData.length &&
    separatedSpectrumData.length
  ) {
    const fBins = Math.min(originalSpectrumData.length, separatedSpectrumData.length);
    const tBins = Array.isArray(originalSpectrumData[0])
      ? Math.min(
          originalSpectrumData[0].length,
          Array.isArray(separatedSpectrumData[0]) ? separatedSpectrumData[0].length : 0,
        )
      : 0;
    if (tBins) {
      let lowSum = 0;
      let midSum = 0;
      let highSum = 0;
      let lowCount = 0;
      let midCount = 0;
      let highCount = 0;
      for (let f = 0; f < fBins; f += 1) {
        const bandPos = f / (fBins - 1 || 1); // 0~1，从低频到高频
        const rowA = originalSpectrumData[f] || [];
        const rowB = separatedSpectrumData[f] || [];
        for (let t = 0; t < tBins; t += 1) {
          const a = rowA[t] ?? 0;
          const b = rowB[t] ?? 0;
          const diff = a - b;
          const e = diff * diff;
          if (bandPos < 0.25) {
            lowSum += e;
            lowCount += 1;
          } else if (bandPos < 0.7) {
            midSum += e;
            midCount += 1;
          } else {
            highSum += e;
            highCount += 1;
          }
        }
      }
      const safe = (s, c) => (c > 0 ? s / c : 0);
      lowErr = safe(lowSum, lowCount);
      midErr = safe(midSum, midCount);
      highErr = safe(highSum, highCount);
    }
  }

  const fmtBand = (v) =>
    typeof v === "number" && isFinite(v) ? v.toExponential(2) : "N/A";

  const bandData = [
    { band: "Low", value: typeof lowErr === "number" && isFinite(lowErr) ? lowErr : 0 },
    { band: "Mid", value: typeof midErr === "number" && isFinite(midErr) ? midErr : 0 },
    { band: "High", value: typeof highErr === "number" && isFinite(highErr) ? highErr : 0 },
  ];

  return (
    <div className="h-40 grid grid-rows-[1fr_auto] gap-1">
      <div className="grid grid-cols-3 gap-2">
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

      {/* 中间：分离后频谱 */}
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
      </div>

      {/* 右侧：差分频谱 |Mix - Alg| */}
      <div
        className="bg-slate-950 rounded border border-slate-700 p-1 relative overflow-hidden group"
        onMouseDown={(e) => handleMouseDown(e, separatedCanvasRef)}
        onMouseMove={(e) => handleMouseMove(e, separatedCanvasRef)}
        onMouseUp={(e) => handleMouseUp(e, separatedCanvasRef)}
        onMouseLeave={(e) => handleMouseUp(e, separatedCanvasRef)}
        onDoubleClick={handleDoubleClick}
      >
        <canvas
          ref={diffCanvasRef}
          width={256}
          height={160}
          className="w-full h-full object-cover"
        />
        <div className="absolute top-1 left-2 text-xs text-red-300 font-mono bg-black/50 px-1 rounded">
          |Mix-Alg|
        </div>
      </div>
      {/* 选中区域可视化（覆盖整个组件宽度，便于感知当前缩放动作） */}
      {dragging && dragStartX !== null && dragCurrentX !== null && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{ gridColumn: "1 / span 3" }}
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

      {/* 频带误差概要：低/中/高频段的平均差分能量（越小越好） */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
        <div className="flex-1 h-16">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={bandData}
              margin={{ top: 4, right: 8, left: 0, bottom: 8 }}
              barCategoryGap={18}
            >
              <CartesianGrid vertical={false} stroke="#1f2937" strokeDasharray="3 3" />
              <XAxis
                dataKey="band"
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                axisLine={{ stroke: "#4b5563" }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                axisLine={{ stroke: "#4b5563" }}
                tickFormatter={(v) =>
                  typeof v === "number" && v > 0 ? v.toExponential(1) : "0"
                }
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "#020617",
                  border: "1px solid #1f2937",
                  fontSize: 11,
                }}
                formatter={(value) => fmtBand(value)}
                labelFormatter={(label) => `${label} Band`}
              />
              <Bar
                dataKey="value"
                fill="#22d3ee"
                radius={[3, 3, 0, 0]}
                maxBarSize={24}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="ml-4 flex flex-col gap-1 font-mono">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Low</span>
            <span className="text-slate-200">{fmtBand(lowErr)}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            <span>Mid</span>
            <span className="text-slate-200">{fmtBand(midErr)}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span>High</span>
            <span className="text-slate-200">{fmtBand(highErr)}</span>
          </span>
        </div>
      </div>
    </div>
  );
};

// 单音频波形视图：一条音频 = 一块独立波形面板（Au 风格）
const SingleWaveformView = ({
  wave,
  heightPx = 160,
  color = "rgba(56, 189, 248, 0.92)", // cyan-400
  fillColor = "rgba(56, 189, 248, 0.16)",
  autoGain = true,
  yZoom = 1.0,
  viewRange,
  playbackState = { currentTime: 0, duration: 0, playing: false, seek: null },
}) => {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const [layout, setLayout] = useState({ w: 800, h: heightPx });
  const [hoverX, setHoverX] = useState(null);

  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  const unpackWave = useCallback((input) => {
    if (Array.isArray(input)) {
      return { mid: input, min: null, max: null };
    }
    if (input && typeof input === "object") {
      const wMin = input.min;
      const wMax = input.max;
      if (Array.isArray(wMin) && Array.isArray(wMax) && wMin.length && wMax.length) {
        const n = Math.min(wMin.length, wMax.length);
        const mid = new Array(n);
        for (let i = 0; i < n; i += 1) {
          const a = typeof wMin[i] === "number" && isFinite(wMin[i]) ? wMin[i] : 0;
          const b = typeof wMax[i] === "number" && isFinite(wMax[i]) ? wMax[i] : 0;
          mid[i] = (a + b) * 0.5;
        }
        return { mid, min: wMin, max: wMax };
      }
    }
    return { mid: [], min: null, max: null };
  }, []);

  const getValAt = useCallback((arr, pos01) => {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    if (arr.length === 1) return arr[0] || 0;
    const p = clamp01(pos01);
    const idx = Math.floor(p * (arr.length - 1));
    const v = arr[idx];
    return typeof v === "number" && isFinite(v) ? v : 0;
  }, []);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries?.[0];
      const rect = entry?.contentRect;
      if (!rect) return;
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      setLayout((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = layout.w || canvas.clientWidth || 800;
    const cssHeight = layout.h || canvas.clientHeight || heightPx;
    const width = cssWidth;
    const height = cssHeight;

    const pxW = Math.max(1, Math.floor(cssWidth * dpr));
    const pxH = Math.max(1, Math.floor(cssHeight * dpr));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);

    // 背景 & 网格
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gridX = Math.max(40, Math.floor(width / 16));
    const gridY = Math.max(24, Math.floor(height / 8));
    for (let x = 0; x < width; x += gridX) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += gridY) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    const centerY = height / 2;
    const vrStart = Math.max(0, Math.min(1, viewRange?.start ?? 0));
    const vrEnd = Math.max(vrStart, Math.min(1, viewRange?.end ?? 1));
    const span = Math.max(0.0001, vrEnd - vrStart);

    const wv = unpackWave(wave);
    const midArr = Array.isArray(wv.mid) ? wv.mid : [];
    const minArr = Array.isArray(wv.min) ? wv.min : null;
    const maxArr = Array.isArray(wv.max) ? wv.max : null;

    // 零线
    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    const getPeakAbsInView = (arr) => {
      if (!Array.isArray(arr) || arr.length === 0) return 0;
      const s = Math.max(0, Math.min(arr.length - 1, Math.floor(vrStart * (arr.length - 1))));
      const e = Math.max(s, Math.min(arr.length - 1, Math.ceil(vrEnd * (arr.length - 1))));
      let peak = 0;
      for (let i = s; i <= e; i += 1) {
        const v = arr[i];
        if (typeof v !== "number" || !isFinite(v)) continue;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
      return peak;
    };

    let baseScaleY = height * 0.44;
    if (autoGain) {
      const peak = getPeakAbsInView(midArr);
      const denom = peak > 1e-6 ? peak : 1.0;
      baseScaleY = (height * 0.44) / denom;
    }
    const safeZoom = typeof yZoom === "number" && isFinite(yZoom) ? Math.max(0.1, Math.min(10, yZoom)) : 1.0;
    const scaleY = baseScaleY * safeZoom;

    // 先绘制包络填充（若有）
    if (minArr && maxArr && minArr.length && maxArr.length) {
      ctx.beginPath();
      ctx.fillStyle = fillColor;
      for (let i = 0; i < width; i += 1) {
        const pos = vrStart + (i / width) * span;
        const v = getValAt(maxArr, pos);
        if (i === 0) ctx.moveTo(i, centerY + v * scaleY);
        else ctx.lineTo(i, centerY + v * scaleY);
      }
      for (let i = width - 1; i >= 0; i -= 1) {
        const pos = vrStart + (i / width) * span;
        const v = getValAt(minArr, pos);
        ctx.lineTo(i, centerY + v * scaleY);
      }
      ctx.closePath();
      ctx.fill();
    }

    // 中线
    if (midArr.length) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      for (let i = 0; i < width; i += 1) {
        const pos = vrStart + (i / width) * span;
        const v = getValAt(midArr, pos);
        if (i === 0) ctx.moveTo(i, centerY + v * scaleY);
        else ctx.lineTo(i, centerY + v * scaleY);
      }
      ctx.stroke();
    }

    // hover 竖线
    if (hoverX !== null && isFinite(hoverX)) {
      const x = clamp01(hoverX) * width;
      ctx.strokeStyle = "rgba(226, 232, 240, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // 全局播放进度竖线
    if (playbackState?.duration > 0) {
      const globalPos = playbackState.currentTime / playbackState.duration;
      const posInView = (globalPos - vrStart) / span;
      if (posInView >= 0 && posInView <= 1) {
        const x = posInView * width;
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(x, height - 6, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [wave, autoGain, yZoom, viewRange, playbackState, layout, hoverX, unpackWave, getValAt, heightPx, color, fillColor]);

  const getNormalizedX = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  };

  const handleMouseMove = (e) => {
    setHoverX(getNormalizedX(e));
  };

  const handleMouseLeave = () => setHoverX(null);

  const handleClick = (e) => {
    if (!playbackState?.seek || !playbackState?.duration) return;
    const nx = getNormalizedX(e);
    const vrStart = Math.max(0, Math.min(1, viewRange?.start ?? 0));
    const vrEnd = Math.max(vrStart, Math.min(1, viewRange?.end ?? 1));
    const span = Math.max(0.0001, vrEnd - vrStart);
    const globalPos = vrStart + nx * span;
    const time = globalPos * playbackState.duration;
    playbackState.seek(time);
  };

  return (
    <div
      ref={wrapperRef}
      className="w-full"
      style={{ height: heightPx }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="w-full h-full rounded border border-slate-700 bg-slate-950" />
    </div>
  );
};

// 单音频频谱视图：一条音频 = 一块独立 Spectrogram 面板（带进度红线）
const SingleSpectrogramView = ({
  spectrum,
  heightPx = 180,
  viewRange,
  onViewRangeChange,
  playbackState = { currentTime: 0, duration: 0 },
}) => {
  const canvasRef = useRef(null);

  const drawSpectrogram = useCallback(
    (canvas, data) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#020617";
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
        const f = Math.floor(((h - 1 - y) / h) * fBins);
        const row = data[f] || [];
        for (let x = 0; x < w; x += 1) {
          const pos = vrStart + (x / w) * span;
          const t = Math.floor(pos * (tBins - 1));
          const vRaw = row[t] ?? 0;
          const v = Math.max(0, Math.min(1, vRaw));

          // 与主频谱视图保持一致的配色
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

      // 绘制进度红线：基于全局播放时间，确保两路频谱同步
      if (playbackState?.duration > 0) {
        const globalPos = playbackState.currentTime / playbackState.duration;
        const posInView = (globalPos - vrStart) / span;
        if (posInView >= 0 && posInView <= 1) {
          const x = posInView * w;
          ctx.strokeStyle = "#f97373"; // 柔和红色
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      }
    },
    [viewRange, playbackState],
  );

  useEffect(() => {
    drawSpectrogram(canvasRef.current, spectrum);
  }, [spectrum, viewRange, drawSpectrogram]);

  const getNormalizedX = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  };

  const handleDragZoom = (() => {
    let dragging = false;
    let startX = 0;

    const finalize = (nxStart, nxEnd) => {
      if (!onViewRangeChange) return;
      const s = Math.min(nxStart, nxEnd);
      const e = Math.max(nxStart, nxEnd);
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

    const onMouseDown = (e) => {
      dragging = true;
      startX = getNormalizedX(e);
    };

    const onMouseMove = (e) => {
      if (!dragging) return;
      // 仅记录末端位置，不需要单独保存 currentX
      getNormalizedX(e);
    };

    const onMouseUp = (e) => {
      if (!dragging) return;
      const nx = getNormalizedX(e);
      dragging = false;
      finalize(startX, nx);
    };

    const onMouseLeave = () => {
      dragging = false;
    };

    return { onMouseDown, onMouseMove, onMouseUp, onMouseLeave };
  })();

  const handleDoubleClick = () => {
    if (onViewRangeChange) onViewRangeChange({ start: 0, end: 1 });
  };

  if (!Array.isArray(spectrum) || !spectrum.length) {
    return (
      <div className="h-40 flex items-center justify-center text-slate-500 bg-slate-950 rounded border border-slate-700">
        无频谱数据
      </div>
    );
  }

  return (
    <div
      className="w-full"
      style={{ height: heightPx }}
      onMouseDown={handleDragZoom.onMouseDown}
      onMouseMove={handleDragZoom.onMouseMove}
      onMouseUp={handleDragZoom.onMouseUp}
      onMouseLeave={handleDragZoom.onMouseLeave}
      onDoubleClick={handleDoubleClick}
    >
      <canvas
        ref={canvasRef}
        width={256}
        height={heightPx}
        className="w-full h-full rounded border border-slate-700 bg-slate-950"
      />
    </div>
  );
};

// 简单电平表（借鉴 Au）：基于当前播放位置附近的波形包络估算 RMS / Peak，做相对电平对比
const LevelMeter = ({ wave, playbackState, label, theme = "emerald" }) => {
  const themeColor = theme === "cyan" ? "#22d3ee" : theme === "purple" ? "#a855f7" : "#10b981";

  const { rmsDb, norm } = useMemo(() => {
    const duration = playbackState?.duration || 0;
    const t = playbackState?.currentTime || 0;
    // 统一展开波形：支持 number[] 或 { min:number[], max:number[] } 包络
    const resolveWaveArray = (input) => {
      if (Array.isArray(input)) return input;
      if (input && typeof input === "object") {
        const wMin = input.min;
        const wMax = input.max;
        if (Array.isArray(wMin) && Array.isArray(wMax) && wMin.length && wMax.length) {
          const n = Math.min(wMin.length, wMax.length);
          const mid = new Array(n);
          for (let i = 0; i < n; i += 1) {
            const a = typeof wMin[i] === "number" && isFinite(wMin[i]) ? wMin[i] : 0;
            const b = typeof wMax[i] === "number" && isFinite(wMax[i]) ? wMax[i] : 0;
            mid[i] = (a + b) * 0.5;
          }
          return mid;
        }
      }
      return [];
    };

    const data = resolveWaveArray(wave);
    if (!duration || !data.length) {
      return { rmsDb: -60, peakDb: -60, norm: 0 };
    }
    const pos = Math.max(0, Math.min(1, t / duration));
    const center = Math.floor(pos * (data.length - 1));
    const win = Math.max(4, Math.floor(data.length * 0.01));
    const start = Math.max(0, center - win);
    const end = Math.min(data.length - 1, center + win);
    let sumSq = 0;
    let peak = 0;
    let count = 0;
    for (let i = start; i <= end; i += 1) {
      const v = typeof data[i] === "number" && isFinite(data[i]) ? data[i] : 0;
      const a = Math.abs(v);
      sumSq += a * a;
      if (a > peak) peak = a;
      count += 1;
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    const toDb = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -60);
    const rmsDb = toDb(rms);
    // 归一到 [0,1]，-60dB -> 0, 0dB -> 1
    const norm = Math.max(0, Math.min(1, (rmsDb + 60) / 60));
    return { rmsDb, norm };
  }, [wave, playbackState]);

  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-400">
      <span className="w-16 truncate">{label}</span>
      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700/60">
        <div
          className="h-full transition-all"
          style={{
            width: `${(norm || 0) * 100}%`,
            background: `linear-gradient(90deg, ${themeColor}, #f97316)`,
          }}
        />
      </div>
      <span className="w-12 text-right font-mono text-slate-300">
        {Number.isFinite(rmsDb) ? rmsDb.toFixed(1) : "-∞"}dB
      </span>
    </div>
  );
};

// --- Queue Position Toast Component ---
const QueuePositionToast = ({ position, queueLength, isProcessing, onCancel, onClose, isCancelling }) => {
  if (position === null) return null;
  
  return (
    <div className="fixed bottom-4 right-4 z-[9998] pointer-events-auto">
      <div className="bg-slate-800 border-2 border-cyan-500/50 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.3)] rounded-lg shadow-xl min-w-[280px] max-w-[400px] p-4 backdrop-blur-sm animate-in slide-in-from-bottom-full duration-300">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 bg-cyan-500/10 rounded-full flex items-center justify-center border border-cyan-500/30">
            <Users size={20} className="text-cyan-400" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-cyan-300 mb-1">任务排队中</div>
            {isProcessing ? (
              <div className="text-xs text-slate-400">
                正在处理您的任务...
              </div>
            ) : position > 0 ? (
              <div className="text-xs text-slate-400">
                您当前排在第 <span className="text-cyan-400 font-bold text-base">{position}</span> 位
                {queueLength > 1 && (
                  <span className="text-slate-500">（共 {queueLength} 个任务）</span>
                )}
              </div>
            ) : (
              <div className="text-xs text-slate-400">
                任务已加入队列
              </div>
            )}
            {/* 取消按钮 - 仅在排队时显示（不在处理中时） */}
            {!isProcessing && onCancel && (
              <button
                onClick={onCancel}
                disabled={isCancelling}
                className={`mt-2 w-full px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  isCancelling
                    ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                    : "bg-red-500/90 hover:bg-red-500 text-white shadow-sm shadow-red-500/40"
                }`}
              >
                {isCancelling ? "正在取消..." : "取消等待"}
              </button>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="flex-shrink-0 hover:opacity-70 transition-opacity text-slate-400 hover:text-white"
              aria-label="关闭"
            >
              <CloseIcon size={18} />
            </button>
          )}
        </div>
      </div>
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
// Algorithm 下拉框的“无”选项（前端哨兵值；不要传给后端）
const ALGO_NONE = "__NONE__";
const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export default function AudioLabApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showError, showSuccess, showAlert } = useToast();
  const [audioUrl, setAudioUrl] = useState(null); // 存放本地播放地址（从音频资源库选择后生成的本地 URL）
  const [user, setUser] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [currentView, setCurrentView] = useState("dashboard"); // dashboard, evaluate, stats, audio_resources
  const [file, setFile] = useState(null);
  const [rawFile, setRawFile] = useState(null); // 保存真实 File，用于上传到后端
  const [stems, setStems] = useState([]);
  const [currentStem, setCurrentStem] = useState(null); // 当前选中的单声源（用于与金标准对比）
  const [isProcessing, setIsProcessing] = useState(false);
  // 默认选中“无”，便于取消/结束后再次选择算法
  const [selectedAlgo, setSelectedAlgo] = useState(ALGO_NONE);
  const [results, setResults] = useState(null);
  // 客观指标：按 stem 缓存（需要用户上传金标准 reference 才能计算）
  const [objectiveByStem, setObjectiveByStem] = useState({});
  const [objectiveLoading, setObjectiveLoading] = useState(false);
  const [objectiveError, setObjectiveError] = useState(null);
  const [taskId, setTaskId] = useState(null);
  const [progressText, setProgressText] = useState(""); // 进度文本
  const [isCancelling, setIsCancelling] = useState(false); // 是否正在取消当前任务
  const cancelSeparationRef = useRef({ requested: false }); // 取消标记，用于打断轮询
  const [queuePosition, setQueuePosition] = useState(null); // 队列位置信息 {position, queue_length, is_processing}
  const queuePollIntervalRef = useRef(null); // 队列位置轮询定时器
  // 历史任务导入相关状态
  const [historyIdInput, setHistoryIdInput] = useState("");
  const [historyImportLoading, setHistoryImportLoading] = useState(false);
  const [myTaskHistory, setMyTaskHistory] = useState([]);
  const [myTaskHistoryPage, setMyTaskHistoryPage] = useState(1);
  const [myTaskHistoryTotalPages, setMyTaskHistoryTotalPages] = useState(1);
  const [myTaskHistoryLoading, setMyTaskHistoryLoading] = useState(false);
  const [myTaskHistoryError, setMyTaskHistoryError] = useState(null);
  const [claimAnonymousLoading, setClaimAnonymousLoading] = useState(false);
  // 自定义残差 / 混合播放器相关状态
  const [mixSelectedStems, setMixSelectedStems] = useState([]);
  const [mixMode, setMixMode] = useState("remove"); // "keep" | "remove"
  const [mixAudioFile, setMixAudioFile] = useState(null);
  const [mixLoading, setMixLoading] = useState(false);
  const [mixError, setMixError] = useState(null);
  // 可视化的时间视窗 [0,1]，0 和 1 分别代表整段音频的起止
  const [viewRange, setViewRange] = useState({ start: 0, end: 1 });
  // 波形显示增强：仅影响展示（便于对比），不改变任何音频/评分数据
  const [waveAutoGain, setWaveAutoGain] = useState(true);
  const [waveYZoom, setWaveYZoom] = useState(1.6);
  const [waveExpanded, setWaveExpanded] = useState(false);
  // 按 stem 维度存储主观评分：stemName -> { quality, interference, artifacts }
  const [stemScores, setStemScores] = useState({});

  // ---- 播放进度统一同步（Input / Gold / Stem 共用一条“全局时间轴”）----
  const inputPlaybackRef = useRef(null);
  const goldPlaybackRef = useRef(null);
  const stemPlaybackRef = useRef(null);
  const activePlayerKeyRef = useRef(null); // 'input' | 'gold' | 'stem' | null

  const [syncedCurrentTime, setSyncedCurrentTime] = useState(0);
  const [globalPlaybackRate, setGlobalPlaybackRate] = useState(1.0);
  const [syncedDuration, setSyncedDuration] = useState(0);
  const [syncedPlaying, setSyncedPlaying] = useState(false);
  
  // 保存三个播放器的引用，用于互斥播放
  const inputSourceAudioRef = useRef(null);
  const goldStandardAudioRef = useRef(null);
  const separatedStemAudioRef = useRef(null);
  const residualStemAudioRef = useRef(null);
  const previousPlayingState = useRef({
    input: false,
    gold: false,
    separated: false,
    residual: false,
  });

  // Realtime stats（仅使用后端统计）
  const [computeMode, setComputeMode] = useState("gpu");
  // 后端统计数据
  const [backendStats, setBackendStats] = useState([]);
  const [algorithmComparison, setAlgorithmComparison] = useState([]);
  // 实时评分雷达图：用户选择要展示/叠加的算法（空数组时默认展示前 2 名）
  const [selectedRadarAlgorithms, setSelectedRadarAlgorithms] = useState([]);
  // 实时评分雷达图：按 stem 声源分类的过滤（"ALL" 表示总体）
  const [selectedRadarStem, setSelectedRadarStem] = useState("ALL");
  // 社区评论页筛选状态（不会影响工作台和统计页，只影响 /comments）
  const [commentsAlgorithmFilter, setCommentsAlgorithmFilter] = useState("");
  const [commentsStemFilter, setCommentsStemFilter] = useState("");
  // 根据筛选条件过滤后的后端统计（用于评论页的统计卡片和列表）
  const filteredBackendStatsForComments = useMemo(
    () =>
      backendStats.filter((row) => {
        const algoOk =
          !commentsAlgorithmFilter ||
          row.algorithm === commentsAlgorithmFilter;
        const stemName = row.stem_name || row.stemName || "";
        const stemOk =
          !commentsStemFilter || stemName === commentsStemFilter;
        return algoOk && stemOk;
      }),
    [backendStats, commentsAlgorithmFilter, commentsStemFilter],
  );
  // 根据筛选条件过滤后的算法对比信息（用于专家讨论模块）
  const filteredAlgorithmComparison = useMemo(
    () =>
      algorithmComparison.filter((algo) => {
        const algoOk =
          !commentsAlgorithmFilter ||
          algo.algorithm === commentsAlgorithmFilter;
        const stemOk =
          !commentsStemFilter ||
          (Array.isArray(algo.stem_breakdown) &&
            algo.stem_breakdown.some(
              (stem) =>
                stem.stem_name === commentsStemFilter ||
                stem.stemName === commentsStemFilter,
            ));
        return algoOk && stemOk;
      }),
    [algorithmComparison, commentsAlgorithmFilter, commentsStemFilter],
  );
  // 按算法聚合的客观指标统计（用于客观指标雷达图等）
  const [, setObjectiveStats] = useState([]);
  // 单条“主观 + 客观”联合样本点，用于相关性散点图
  const [, setSubjectiveObjectivePoints] = useState([]);
  // 按算法的 SDR 样本分布（用于近似箱线/蜂群散点）
  const [, setObjectiveDistribution] = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);
  // 当前专家自己的评分记录（用于“删除某一次手滑评分”）
  const [myScoreRecords, setMyScoreRecords] = useState([]);
  const [loadingMyScores, setLoadingMyScores] = useState(false);
  const [myScoresError, setMyScoresError] = useState(null);
  
  // 通知相关状态
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [showExpertMessageDialog, setShowExpertMessageDialog] = useState(false);
  const [showUserProfileDialog, setShowUserProfileDialog] = useState(false);

  // 波形/频谱：等待后端分析结果（空数组表示暂无数据，避免 mock 误导）
  // 波形支持 DAW 式包络(envelope)：min/max 两条曲线，避免“每桶一个点”导致瞬态被压扁
  const [gtWave, setGtWave] = useState([]); // 原始混合音（mixture，中线兼容）
  const [gtWaveEnv, setGtWaveEnv] = useState(null); // { min: number[], max: number[] }
  const [sepWave, setSepWave] = useState([]); // 算法分离结果波形（separated，中线兼容）
  const [sepWaveEnv, setSepWaveEnv] = useState(null); // { min: number[], max: number[] }（供后续扩展/调试使用）
  const [, setGtSpectrum] = useState([]);
  const [sepSpectrum, setSepSpectrum] = useState([]);
  const [, setGtFrequencyResponse] = useState([]); // 标准音频频率响应
  const [sepFrequencyResponse, setSepFrequencyResponse] = useState([]); // 分离音频频率响应
  const [goldWave, setGoldWave] = useState(null); // Gold Standard 波形（可选）
  const [goldWaveEnv, setGoldWaveEnv] = useState(null); // Gold Standard 包络（可选）
  const [goldSpectrum, setGoldSpectrum] = useState(null); // Gold Standard 频谱（可选）
  const [goldFrequencyResponse, setGoldFrequencyResponse] = useState(null); // Gold Standard 频率响应（可选）
  const [gtFile, setGtFile] = useState(null); // 用户上传的"金标准"单源
  const gtFileRef = useRef(null); // 使用 ref 保存文件对象，避免状态更新时丢失
  // 音频元数据：采样率和位深度
  const [audioMetadata, setAudioMetadata] = useState({
    sampleRate: null,
    bitDepth: null,
    fileFormat: null, // 文件格式，用于显示解释
  });
  // 暂停时自动放大频谱图对应时间带（目前仅内部使用，不暴露 UI 开关）
  const [autoZoomSpectrumOnPause] = useState(false);
  // 音频资源选择器状态
  const [showResourceSelector, setShowResourceSelector] = useState(false);
  const [resourceSelectorType, setResourceSelectorType] = useState(null); // 'input' 或 'gold'
  // 使用“基础标题”作为成组音频的 bundle 标识，例如：`SongName [Mixture]` / `SongName [Gold Vocals]`
  const [currentBundleId, setCurrentBundleId] = useState(null);
  
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

  // 根据当前选择的 stems 和模式，请求后端生成混合 / 残差音频
  const generateMixedAudio = async () => {
    if (!taskId) {
      showError("请先完成一次音频分离任务");
      return;
    }
    if (!stems || stems.length === 0) {
      showError("当前没有可用的 stem");
      return;
    }
    if (!mixSelectedStems || mixSelectedStems.length === 0) {
      showError("请至少选择一个声部");
      return;
    }

    setMixLoading(true);
    setMixError(null);
    try {
      const url =
        typeof taskId === "string"
          ? `${API_BASE}/api/tasks/${encodeURIComponent(taskId)}/mix`
          : `${API_BASE}/api/tasks/${encodeURIComponent(String(taskId))}/mix`;

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stem_names: mixSelectedStems,
          mode: mixMode,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `HTTP ${resp.status}`);
      }

      const blob = await resp.blob();
      const fileName =
        mixMode === "remove"
          ? `residual_mix_remove_${(mixSelectedStems || []).join("_") || "none"}.wav`
          : `custom_mix_keep_${(mixSelectedStems || []).join("_") || "none"}.wav`;

      const file = new File([blob], fileName, { type: blob.type || "audio/wav" });
      setMixAudioFile(file);
    } catch (e) {
      console.error("[generateMixedAudio] failed:", e);
      setMixError(e.message || String(e));
      showError(`生成混合音频失败：${e.message || e}`);
    } finally {
      setMixLoading(false);
    }
  };

  // --- 自适应可视化分辨率（随着缩放自动提高）---
  // 说明：后端 /analysis 已支持 waveform_points/spec_time_bins/spec_freq_bins 参数
  // 这里只在 zoom-in（viewRange 变小）时提升分辨率，不在 zoom-out 时降级，避免频繁拉取
  const analysisAdaptiveRef = useRef({
    taskId: null,
    target: null,
    waveform_points: 800,
    spec_time_bins: 256,
    spec_freq_bins: 128,
    inFlightKey: null,
  });
  const analysisAbortRef = useRef(null);
  const analysisDebounceRef = useRef(null);

  const getAdaptiveParams = useCallback((zoom) => {
    // zoom 约等于 1/span；这里用分段函数避免过于激进
    const z = typeof zoom === "number" && isFinite(zoom) ? Math.max(1, zoom) : 1;
    if (z <= 2) return { waveform_points: 800, spec_time_bins: 256, spec_freq_bins: 128 };
    if (z <= 4) return { waveform_points: 2000, spec_time_bins: 384, spec_freq_bins: 128 };
    if (z <= 8) return { waveform_points: 4000, spec_time_bins: 512, spec_freq_bins: 128 };
    return { waveform_points: 8000, spec_time_bins: 768, spec_freq_bins: 128 };
  }, []);

  useEffect(() => {
    const taskIdStr = typeof taskId === "string" ? taskId : taskId != null ? String(taskId) : "";
    const targetStem = currentStem?.name || "";
    if (!taskIdStr || !targetStem) return;
    if (isProcessing) return;

    const span = Math.max(0.0001, (viewRange?.end ?? 1) - (viewRange?.start ?? 0));
    const zoom = 1 / span;
    const want = getAdaptiveParams(zoom);

    const prev = analysisAdaptiveRef.current;
    const prevKey = `${prev.taskId}::${prev.target}::${prev.waveform_points}::${prev.spec_time_bins}::${prev.spec_freq_bins}`;
    const wantKey = `${taskIdStr}::${targetStem}::${want.waveform_points}::${want.spec_time_bins}::${want.spec_freq_bins}`;

    // 同一个参数，不要重复拉；以及避免“降级”导致反复请求
    const isSame = prevKey === wantKey;
    const isDowngrade =
      prev.taskId === taskIdStr &&
      prev.target === targetStem &&
      (want.waveform_points <= prev.waveform_points) &&
      (want.spec_time_bins <= prev.spec_time_bins) &&
      (want.spec_freq_bins <= prev.spec_freq_bins);
    if (isSame || isDowngrade) return;

    // 防抖：用户拖拽缩放时不要每一帧都请求
    if (analysisDebounceRef.current) clearTimeout(analysisDebounceRef.current);
    analysisDebounceRef.current = setTimeout(async () => {
      // 取消上一请求
      if (analysisAbortRef.current) {
        try { analysisAbortRef.current.abort(); } catch { /* ignore */ }
      }
      const ac = new AbortController();
      analysisAbortRef.current = ac;
      analysisAdaptiveRef.current = {
        taskId: taskIdStr,
        target: targetStem,
        waveform_points: want.waveform_points,
        spec_time_bins: want.spec_time_bins,
        spec_freq_bins: want.spec_freq_bins,
        inFlightKey: wantKey,
      };

      try {
        const url =
          `${API_BASE}/api/tasks/${encodeURIComponent(taskIdStr)}/analysis` +
          `?target=${encodeURIComponent(targetStem)}` +
          `&include_all_stems=false` +
          `&waveform_points=${encodeURIComponent(String(want.waveform_points))}` +
          `&spec_time_bins=${encodeURIComponent(String(want.spec_time_bins))}` +
          `&spec_freq_bins=${encodeURIComponent(String(want.spec_freq_bins))}`;

        const resp = await fetch(url, { signal: ac.signal });
        if (!resp.ok) throw new Error(await resp.text());

        let analysisResponseText = await resp.text();
        const analysisIdPattern = /"task_id"\s*:\s*(\d+)/g;
        if (analysisIdPattern.test(analysisResponseText)) {
          analysisResponseText = analysisResponseText.replace(
            /"task_id"\s*:\s*(\d+)/g,
            `"task_id":"$1"`,
          );
        }
        const a = JSON.parse(analysisResponseText);

        // original（mixture）
        if (a?.original?.waveform?.length) setGtWave(a.original.waveform);
        if (Array.isArray(a?.original?.waveform_min) && Array.isArray(a?.original?.waveform_max)) {
          setGtWaveEnv({ min: a.original.waveform_min, max: a.original.waveform_max });
        }
        if (a?.original?.spectrogram?.length) setGtSpectrum(a.original.spectrogram);
        if (Array.isArray(a?.original?.frequency_response)) {
          setGtFrequencyResponse(a.original.frequency_response);
        }

        // target（当前 stem）
        if (a?.target?.waveform?.length) setSepWave(a.target.waveform);
        if (Array.isArray(a?.target?.waveform_min) && Array.isArray(a?.target?.waveform_max)) {
          setSepWaveEnv({ min: a.target.waveform_min, max: a.target.waveform_max });
        }
        if (a?.target?.spectrogram?.length) setSepSpectrum(a.target.spectrogram);
        if (Array.isArray(a?.target?.frequency_response)) {
          setSepFrequencyResponse(a.target.frequency_response);
        }

        // 同步写回 stems 数组中"当前 stem"的缓存，方便后续复用
        setStems((prevStems) =>
          (prevStems || []).map((st) => {
            if (!st || st.name !== targetStem) return st;
            return {
              ...st,
              waveform: Array.isArray(a?.target?.waveform) ? a.target.waveform : st.waveform,
              waveformEnv:
                Array.isArray(a?.target?.waveform_min) && Array.isArray(a?.target?.waveform_max)
                  ? { min: a.target.waveform_min, max: a.target.waveform_max }
                  : st.waveformEnv || null,
              spectrum: Array.isArray(a?.target?.spectrogram) ? a.target.spectrogram : st.spectrum,
              frequencyResponse: Array.isArray(a?.target?.frequency_response) ? a.target.frequency_response : st.frequencyResponse,
            };
          }),
        );

      } catch (e) {
        // Abort 属于正常行为，不提示
        const msg = e?.name === "AbortError" ? "" : (e?.message || String(e));
        if (msg) console.warn("自适应 analysis 拉取失败（可忽略）：", msg);
      }
    }, 260);

    return () => {
      if (analysisDebounceRef.current) clearTimeout(analysisDebounceRef.current);
    };
  }, [taskId, currentStem?.name, viewRange, isProcessing, getAdaptiveParams]);

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

  // Auth Effect - 检查本地存储的 token，并在登录后预加载个人历史（用于 history 视图）
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 根据历史记录 ID 直接导入已完成的分离任务，避免重复计算
  const handleImportHistoryById = async () => {
    const raw = (historyIdInput || "").trim();
    if (!raw) {
      showError("请输入历史记录ID");
      return;
    }
    if (!/^\d+$/.test(raw)) {
      showError("历史记录ID格式不正确，仅支持数字");
      return;
    }

    const taskIdStr = raw;
    setHistoryImportLoading(true);
    setIsProcessing(true);
    setProgressText("正在加载历史任务...");
    setResults(null);
    setObjectiveByStem({});
    setObjectiveError(null);
    setStems([]);
    setCurrentStem(null);

    try {
      // 1) 获取任务信息，确认任务存在且已完成
      const taskUrl = `${API_BASE}/api/tasks/${encodeURIComponent(taskIdStr)}`;
      const taskResp = await fetch(taskUrl);
      let taskText = await taskResp.text();
      if (!taskResp.ok) {
        throw new Error(taskText || "加载历史任务失败");
      }
      const idPattern = /"id"\s*:\s*(\d+)/g;
      if (idPattern.test(taskText)) {
        taskText = taskText.replace(/"id"\s*:\s*(\d+)/, `"id":"$1"`);
      }
      const taskData = JSON.parse(taskText);
      if (taskData.status !== "completed") {
        throw new Error("该历史任务尚未完成或已失败，请先完成一次分离任务");
      }

      setTaskId(taskIdStr);
      setSelectedAlgo(taskData.algorithm || ALGO_NONE);

      // 2) 拉取 stems 列表
      const stemsResp = await fetch(
        `${API_BASE}/api/tasks/${encodeURIComponent(taskIdStr)}/stems`,
      );
      if (!stemsResp.ok) throw new Error(await stemsResp.text());

      let stemsResponseText = await stemsResp.text();
      const stemIdPattern = /"id"\s*:\s*(\d+)/g;
      if (stemIdPattern.test(stemsResponseText)) {
        stemsResponseText = stemsResponseText.replace(
          /"id"\s*:\s*(\d+)/g,
          `"id":"$1"`,
        );
      }

      const stemList = JSON.parse(stemsResponseText);
      const stemsMapped = (stemList || []).map((s) => {
        const stemIdStr = typeof s.id === "string" ? s.id : String(s.id);
        return {
          name: s.stem_name,
          src: `${API_BASE}/api/tasks/${taskIdStr}/stems/${stemIdStr}/download`,
          waveform: [],
          waveformEnv: null,
          spectrum: [],
        };
      });

      // 预取 stem 文件，尽量与 runSeparation 行为保持一致
      const stemsWithFiles = await Promise.all(
        stemsMapped.map(async (s) => {
          try {
            const resp = await fetch(s.src);
            if (!resp.ok) throw new Error(`fetch stem failed: ${resp.status}`);
            const blob = await resp.blob();
            const ext = blob.type?.includes("mpeg")
              ? "mp3"
              : blob.type?.includes("wav")
              ? "wav"
              : "bin";
            const filename = s.name ? `${s.name}.${ext}` : `stem.${ext}`;
            const fileObj = new File([blob], filename, {
              type: blob.type || "audio/wav",
            });
            return {
              ...s,
              file: fileObj,
              src: undefined,
            };
          } catch (e) {
            console.warn(
              "[handleImportHistoryById] Stem prefetch failed, fallback to remote src:",
              s.name,
              e,
            );
            return s;
          }
        }),
      );

      setStems(stemsWithFiles);
      setMixSelectedStems(stemsWithFiles.map((s) => s.name));
      setMixAudioFile(null);
      setMixError(null);

      // 2a) 还原混合音频到 Input Source 播放器
      try {
        const mixResp = await fetch(
          `${API_BASE}/api/tasks/${encodeURIComponent(
            taskIdStr,
          )}/mixture/download`,
        );
        if (mixResp.ok) {
          const mixBlob = await mixResp.blob();
          const mixFile = new File(
            [mixBlob],
            taskData.original_filename || "mixture.wav",
            { type: mixBlob.type || "audio/wav" },
          );
          setRawFile(mixFile);
          setFile({
            name: mixFile.name,
            size: (mixFile.size / 1024 / 1024).toFixed(2) + " MB",
          });
          const url = URL.createObjectURL(mixFile);
          setAudioUrl(url);
          setCurrentBundleId(null);
        }
      } catch (e) {
        console.warn(
          "[handleImportHistoryById] mixture prefetch failed, still proceed:",
          e,
        );
      }

      // 3) 写入任务级客观指标
      setResults({
        sdr: taskData.sdr,
        sir: taskData.sir,
        sar: taskData.sar,
        comment: taskData.comment,
      });

      // 4) 拉取分析结果（波形 + 频谱）
      try {
        const aResp = await fetch(
          `${API_BASE}/api/tasks/${encodeURIComponent(
            taskIdStr,
          )}/analysis?target=Vocals&include_all_stems=true`,
        );
        if (aResp.ok) {
          let analysisResponseText = await aResp.text();
          const analysisIdPattern = /"task_id"\s*:\s*(\d+)/g;
          if (analysisIdPattern.test(analysisResponseText)) {
            analysisResponseText = analysisResponseText.replace(
              /"task_id"\s*:\s*(\d+)/g,
              `"task_id":"$1"`,
            );
          }
          const a = JSON.parse(analysisResponseText);

          if (a?.original?.waveform?.length) setGtWave(a.original.waveform);
          if (
            Array.isArray(a?.original?.waveform_min) &&
            Array.isArray(a?.original?.waveform_max)
          ) {
            setGtWaveEnv({
              min: a.original.waveform_min,
              max: a.original.waveform_max,
            });
          }
          if (a?.original?.spectrogram?.length)
            setGtSpectrum(a.original.spectrogram);
          if (Array.isArray(a?.original?.frequency_response)) {
            setGtFrequencyResponse(a.original.frequency_response);
          }

          if (a?.target?.waveform?.length) setSepWave(a.target.waveform);
          if (
            Array.isArray(a?.target?.waveform_min) &&
            Array.isArray(a?.target?.waveform_max)
          ) {
            setSepWaveEnv({
              min: a.target.waveform_min,
              max: a.target.waveform_max,
            });
          }
          if (a?.target?.spectrogram?.length)
            setSepSpectrum(a.target.spectrogram);
          if (Array.isArray(a?.target?.frequency_response)) {
            setSepFrequencyResponse(a.target.frequency_response);
          }

          // 如果 include_all_stems=true，尝试把每个 stem 的分析结果写回 stems 数组，
          // 这样后续在 4. Stem Source 中切换声部时也能立即显示可视化。
          if (a?.stems && typeof a.stems === "object") {
            setStems((prevStems) =>
              (prevStems || []).map((st) => {
                if (!st || !st.name) return st;
                const stemKey = st.name;
                const stemAnalysis = a.stems[stemKey];
                if (!stemAnalysis) return st;
                return {
                  ...st,
                  waveform: Array.isArray(stemAnalysis.waveform)
                    ? stemAnalysis.waveform
                    : st.waveform,
                  waveformEnv:
                    Array.isArray(stemAnalysis.waveform_min) &&
                    Array.isArray(stemAnalysis.waveform_max)
                      ? {
                          min: stemAnalysis.waveform_min,
                          max: stemAnalysis.waveform_max,
                        }
                      : st.waveformEnv || null,
                  spectrum: Array.isArray(stemAnalysis.spectrogram)
                    ? stemAnalysis.spectrogram
                    : st.spectrum,
                  frequencyResponse: Array.isArray(
                    stemAnalysis.frequency_response,
                  )
                    ? stemAnalysis.frequency_response
                    : st.frequencyResponse,
                };
              }),
            );
          }
        }
      } catch (e) {
        console.warn("[handleImportHistoryById] analysis fetch failed:", e);
      }

      setProgressText("历史任务导入完成");
      setIsProcessing(false);
      notifySeparationDone(taskData.algorithm);
    } catch (e) {
      console.error("[handleImportHistoryById] failed:", e);
      showError(e.message || String(e));
      setIsProcessing(false);
      setProgressText("");
    } finally {
      setHistoryImportLoading(false);
    }
  };

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

  // 删除当前用户的一条历史任务记录
  const handleDeleteHistoryTask = async (id) => {
    if (!authToken || !id) return;
    if (
      !window.confirm(
        "确定要删除这条历史记录吗？对应的本地分离结果文件也会被一并清理，释放存储空间。",
      )
    ) {
      return;
    }
    try {
      const resp = await fetch(
        `${API_BASE}/api/tasks/history/${encodeURIComponent(String(id))}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || "删除历史记录失败");
      }
      showSuccess("历史记录已删除（对应本地文件也已清理）");
      // 刷新历史列表
      fetchMyTaskHistory(myTaskHistoryPage || 1);
      // 如果当前 taskId 就是被删的那条，顺便清空当前结果
      if (taskId && String(taskId) === String(id)) {
        setTaskId(null);
        setStems([]);
        setCurrentStem(null);
        setResults(null);
        setObjectiveByStem({});
        setObjectiveError(null);
        setSelectedAlgo(ALGO_NONE);
      }
    } catch (e) {
      console.error("[handleDeleteHistoryTask] failed:", e);
      showError(e.message || String(e));
    }
  };

  // Fetch Stats Effect
  // 评分统计现在完全依赖后端数据库，不再从本地 localStorage / Firestore 拉取全站数据


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

        // 获取算法对比统计（主观评分聚合）
        const comparisonResp = await fetch(`${API_BASE}/api/scores/stats/algorithm-comparison`);
        if (comparisonResp.ok) {
          const comparisonData = await comparisonResp.json();
          setAlgorithmComparison(comparisonData);
        }

        // 获取客观指标统计（按算法聚合 SDR/SIR/SAR）
        try {
          const objResp = await fetch(`${API_BASE}/api/tasks/stats/objective`);
          if (objResp.ok) {
            const objData = await objResp.json();
            setObjectiveStats(Array.isArray(objData) ? objData : []);
          }
        } catch (e) {
          console.warn("Failed to fetch objective stats:", e);
        }

        // 获取“主观 + 客观”联合样本点（用于相关性散点）
        try {
          const jointResp = await fetch(
            `${API_BASE}/api/scores/stats/subjective-objective-points?limit=800`,
          );
          if (jointResp.ok) {
            const jointData = await jointResp.json();
            setSubjectiveObjectivePoints(Array.isArray(jointData) ? jointData : []);
          }
        } catch (e) {
          console.warn("Failed to fetch subjective-objective points:", e);
        }

        // 获取按算法的 SDR 样本分布（用于分布型可视化）
        try {
          const distResp = await fetch(`${API_BASE}/api/tasks/stats/objective-distribution`);
          if (distResp.ok) {
            const distData = await distResp.json();
            setObjectiveDistribution(Array.isArray(distData) ? distData : []);
          }
        } catch (e) {
          console.warn("Failed to fetch objective SDR distribution:", e);
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

  // Fetch Compute Mode from Backend (poll + tab focus)
  useEffect(() => {
    let cancelled = false;
    let apiExists = true;
    let intervalId = null;

    const fetchComputeMode = async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/system/compute-mode`);
        if (resp.ok) {
          const data = await resp.json();
          if (!cancelled) {
            const raw = (data.compute_mode || "gpu").toString().toLowerCase();
            setComputeMode(raw === "cpu" ? "cpu" : "gpu");
          }
          return true;
        }
        if (resp.status === 404) {
          if (!cancelled) {
            setComputeMode("gpu");
          }
          return false;
        }
      } catch (err) {
        if (!cancelled) {
          setComputeMode("gpu");
        }
        return false;
      }
      return false;
    };

    const setupInterval = () => {
      if (!apiExists || intervalId) return;
      intervalId = setInterval(() => {
        fetchComputeMode();
      }, 30000);
    };

    fetchComputeMode().then((exists) => {
      apiExists = exists;
      if (exists) setupInterval();
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible" && apiExists) {
        fetchComputeMode();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const fetchMyScores = useCallback(
    async ({ skip = 0, limit = 100 } = {}) => {
      if (!authToken || !user || user.role !== "expert") return;
      setLoadingMyScores(true);
      setMyScoresError(null);
      try {
        const resp = await fetch(
          `${API_BASE}/api/scores/me?skip=${encodeURIComponent(skip)}&limit=${encodeURIComponent(limit)}`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setMyScoreRecords(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("Failed to fetch my scores:", e);
        const msg = e?.message || String(e);
        setMyScoresError(msg);
      } finally {
        setLoadingMyScores(false);
      }
    },
    [authToken, user],
  );

  const deleteMyScoreRecord = useCallback(
    async (score) => {
      if (!authToken || !user) return;
      if (user.role !== "expert" && user.role !== "admin") return;
      const scoreId = score?.id != null ? String(score.id) : "";
      if (!scoreId) return;

      const ok = typeof window !== "undefined"
        ? window.confirm("确定删除这条评分记录吗？删除后无法恢复。")
        : true;
      if (!ok) return;

      try {
        const resp = await fetch(`${API_BASE}/api/scores/${encodeURIComponent(scoreId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || `HTTP ${resp.status}`);
        }

        showSuccess("评分记录已删除");
        fetchMyScores({ skip: 0, limit: 100 });
      } catch (e) {
        console.error(e);
        showError(`删除失败：${e?.message || e}`);
      }
    },
    [authToken, user, showError, showSuccess, fetchMyScores],
  );

  // 当进入“社区评估数据”页时，拉取当前专家自己的评分列表（用于删除手滑记录）
  useEffect(() => {
    if (!user || !authToken) return;
    if (user.role !== "expert") return;
    if (currentView !== "stats") return;
    fetchMyScores({ skip: 0, limit: 100 });
  }, [user, authToken, currentView, fetchMyScores]);

  // 处理从资源库选择的音频
  const analyzeGoldForVisualization = useCallback(
    async (file) => {
      if (!file) return;
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("waveform_points", "800");
        formData.append("spec_freq_bins", "128");
        formData.append("spec_time_bins", "256");

        const resp = await fetch(`${API_BASE}/api/tasks/analysis/gold`, {
          method: "POST",
          body: formData,
        });
        if (!resp.ok) {
          console.warn("Gold 分析失败:", await resp.text());
          return;
        }
        const a = await resp.json();
        if (Array.isArray(a.waveform)) setGoldWave(a.waveform);
        if (Array.isArray(a.waveform_min) && Array.isArray(a.waveform_max)) {
          setGoldWaveEnv({ min: a.waveform_min, max: a.waveform_max });
        } else {
          setGoldWaveEnv(null);
        }
        if (Array.isArray(a.spectrogram)) setGoldSpectrum(a.spectrogram);
        if (Array.isArray(a.frequency_response)) {
          setGoldFrequencyResponse(a.frequency_response);
        } else {
          setGoldFrequencyResponse(null);
        }
      } catch (e) {
        console.warn("Gold 分析请求异常:", e);
      }
    },
    [],
  );

  const handleResourceSelect = async (file, resource) => {
    if (resourceSelectorType === "input") {
      // 强约束：Input Source 只能选择 Mixture
      const title = resource?.title ? String(resource.title).trim() : "";
      if (!/^(.*)\s+\[Mixture\]\s*$/.test(title)) {
        showError("Input Source 仅允许选择 Mixture 音频（标题需形如：xxx [Mixture]）。");
        setShowResourceSelector(false);
        setResourceSelectorType(null);
        return;
      }

      // 设置为 INPUT SOURCE
      setRawFile(file);
      setFile({
        name: file.name,
        size: (file.size / 1024 / 1024).toFixed(2) + " MB",
      });
      const url = URL.createObjectURL(file);
      setAudioUrl(url);

      // 基于资源标题推断“成组音频”的基础标题，并用于后续 Gold Standard 联动
      // 规则：上传成组资源时，Mixture 命名为 `${title} [Mixture]`
      let bundleId = null;
      if (title) {
        const mixtureMatch = title.match(/^(.*)\s+\[Mixture\]\s*$/);
        if (mixtureMatch && mixtureMatch[1].trim()) {
          bundleId = mixtureMatch[1].trim();
        }
      }
      setCurrentBundleId(bundleId);
    } else if (resourceSelectorType === "gold") {
      // 兜底保护：仅要求 1. Input Source 中已选择任意音频（无须强制成组 Mixture）
      if (!rawFile && !audioUrl) {
        showAlert(
          "请先在 1. Input Source 中选择音频，然后再选择对应的 Gold Standard Stem。",
        );
        setShowResourceSelector(false);
        setResourceSelectorType(null);
        return;
      }
      // 设置为 GOLD STANDARD STEM，并触发后端分析用于可视化
      gtFileRef.current = file;
      setGtFile({
        name: file.name,
        size: (file.size / 1024 / 1024).toFixed(2) + " MB",
        raw: file,
      });
      analyzeGoldForVisualization(file);
    }
    setShowResourceSelector(false);
    setResourceSelectorType(null);
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

  // 拉取当前专家的分离任务历史（用于“我的历史记录”面板）
  const fetchMyTaskHistory = useCallback(
    async (page = 1) => {
      // 需要登录后才能拉取个人历史
      if (!authToken || !user) return;

      setMyTaskHistoryLoading(true);
      setMyTaskHistoryError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("page_size", "10");
        const resp = await fetch(
          `${API_BASE}/api/tasks/history/me?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          },
        );
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(txt || "加载历史记录失败");
        }
        const data = await resp.json();
        setMyTaskHistory(Array.isArray(data.items) ? data.items : []);
        setMyTaskHistoryPage(data.page || 1);
        setMyTaskHistoryTotalPages(data.total_pages || 1);
      } catch (e) {
        console.warn("[fetchMyTaskHistory] failed:", e);
        const msg = e?.message || "加载历史记录失败";
        setMyTaskHistoryError(msg);
        showError(msg);
      } finally {
        setMyTaskHistoryLoading(false);
      }
    },
    [authToken, user, showError],
  );

  const handleClaimAnonymousHistory = useCallback(async () => {
    if (!authToken || !user) return;
    if (claimAnonymousLoading) return;
    setClaimAnonymousLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/tasks/history/claim-anonymous`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || "找回匿名历史失败");
      }
      const data = await resp.json();
      const updated = data?.updated ?? 0;
      showSuccess(`已找回 ${updated} 条匿名历史`);
      fetchMyTaskHistory(1);
    } catch (e) {
      const msg = e?.message || "找回匿名历史失败";
      showError(msg);
    } finally {
      setClaimAnonymousLoading(false);
    }
  }, [authToken, user, claimAnonymousLoading, showError, showSuccess, fetchMyTaskHistory]);

  // 当用户进入 /history（或登录状态就绪）时，自动拉取一次历史记录
  useEffect(() => {
    if (!authToken || !user) return;
    if (currentView !== "history") return;
    fetchMyTaskHistory(1);
  }, [authToken, user, currentView, fetchMyTaskHistory]);

  // 清理队列位置轮询定时器
  useEffect(() => {
    return () => {
      if (queuePollIntervalRef.current) {
        clearInterval(queuePollIntervalRef.current);
        queuePollIntervalRef.current = null;
      }
    };
  }, []);

  const runSeparation = async (algo) => {
    setIsProcessing(true);
    setSelectedAlgo(algo);
    setResults(null);
    setObjectiveByStem({});
    setObjectiveError(null);
    setStems([]);
    setCurrentStem(null);
    setTaskId(null);
    setProgressText("准备上传文件...");
    setIsCancelling(false);
    cancelSeparationRef.current.requested = false;

    try {
      if (!rawFile) {
        showError("请先从音频资源库选择一个音频文件");
        setIsProcessing(false);
        return;
      }

      // 1) 上传文件，创建任务
      setProgressText("正在上传音频文件...");
      const form = new FormData();
      form.append("file", rawFile);
      const uploadHeaders = {};
      if (authToken) {
        uploadHeaders["Authorization"] = `Bearer ${authToken}`;
      }
      const uploadResp = await fetch(
        `${API_BASE}/api/tasks/upload?algorithm=${encodeURIComponent(algo)}`,
        { method: "POST", body: form, headers: uploadHeaders },
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
      setQueuePosition({ position: null, queue_length: 0, is_processing: false });

      // 开始轮询队列位置
      const pollQueuePosition = async () => {
        try {
          const resp = await fetch(`${API_BASE}/api/tasks/queue/${taskIdStr}/position`);
          if (resp.ok) {
            const positionInfo = await resp.json();
            setQueuePosition(positionInfo);
            return positionInfo;
          }
        } catch (e) {
          console.warn("查询队列位置失败:", e);
        }
        return null;
      };

      // 立即查询一次队列位置
      await pollQueuePosition();
      
      // 设置定时轮询队列位置（每2秒查询一次）
      queuePollIntervalRef.current = setInterval(async () => {
        // 检查是否请求取消
        if (cancelSeparationRef.current.requested) {
          if (queuePollIntervalRef.current) {
            clearInterval(queuePollIntervalRef.current);
            queuePollIntervalRef.current = null;
          }
          setQueuePosition(null);
          return;
        }
        
        const positionInfo = await pollQueuePosition();
        // 如果任务开始处理，停止轮询队列位置
        if (positionInfo && positionInfo.is_processing) {
          if (queuePollIntervalRef.current) {
            clearInterval(queuePollIntervalRef.current);
            queuePollIntervalRef.current = null;
          }
          setQueuePosition(null); // 隐藏排队浮窗
        }
      }, 2000);

      // 2) 轮询任务状态直到完成/失败/被取消
      // 先等待一小段时间，确保任务已写入数据库
      await new Promise((res) => setTimeout(res, 500));
      
      // 检查是否在等待期间已经请求取消
      if (cancelSeparationRef.current.requested) {
        setProgressText("任务已取消");
        setIsProcessing(false);
        setIsCancelling(false);
        if (queuePollIntervalRef.current) {
          clearInterval(queuePollIntervalRef.current);
          queuePollIntervalRef.current = null;
        }
        setQueuePosition(null);
        return;
      }
      
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
        // 用户在处理中途或排队时点击了"取消"
        if (cancelSeparationRef.current.requested) {
          setProgressText("正在取消任务...");
          // 停止队列位置轮询
          if (queuePollIntervalRef.current) {
            clearInterval(queuePollIntervalRef.current);
            queuePollIntervalRef.current = null;
          }
          setQueuePosition(null);
          
          try {
            await fetch(`${API_BASE}/api/tasks/${taskIdStr}/cancel`, {
              method: "POST",
            });
          } catch (e) {
            console.error("取消任务失败:", e);
          }
          setIsProcessing(false);
          setIsCancelling(false);
          setProgressText("任务已取消");
          setSelectedAlgo(ALGO_NONE);
          return;
        }
        if (t.status !== lastStatus) {
          if (t.status === "pending") {
            setProgressText("任务排队中，请稍候...");
          } else if (t.status === "processing") {
            // 不展示进度条，仅提示处理中
            setProgressText("正在处理中...");
            // 任务开始处理，停止轮询队列位置
            if (queuePollIntervalRef.current) {
              clearInterval(queuePollIntervalRef.current);
              queuePollIntervalRef.current = null;
            }
            setQueuePosition(null); // 隐藏排队浮窗
          }
          lastStatus = t.status;
        }
        
        await new Promise((res) => setTimeout(res, 1200));
        t = await poll();
      }
      
      // 后端目前使用 FAILED + comment 标记"用户主动取消"
      if (t.status === "failed" && (t.comment || "").includes("任务已被用户取消")) {
        setProgressText("任务已取消");
        setIsProcessing(false);
        setIsCancelling(false);
        // 停止轮询队列位置
        if (queuePollIntervalRef.current) {
          clearInterval(queuePollIntervalRef.current);
          queuePollIntervalRef.current = null;
        }
        setQueuePosition(null);
        setSelectedAlgo(ALGO_NONE);
        return;
      }

      // 停止轮询队列位置
      if (queuePollIntervalRef.current) {
        clearInterval(queuePollIntervalRef.current);
        queuePollIntervalRef.current = null;
      }
      setQueuePosition(null);

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
          waveform: [], // 等后端 analysis 返回真实数据再填充，避免 mock 误导
          waveformEnv: null,
          spectrum: [], // 同上
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
      // 初始化自定义残差 / 混合播放器状态
      setMixSelectedStems(stemsWithFiles.map((s) => s.name));
      setMixAudioFile(null);
      setMixError(null);
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

      // 波形：等待后端 analysis 返回真实数据（无数据则保持为空，避免 mock 误导）
      setSepWave([]);

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
          // 新：后端可能返回 waveform_min/waveform_max（DAW 式包络）
          if (Array.isArray(a?.original?.waveform_min) && Array.isArray(a?.original?.waveform_max)) {
            setGtWaveEnv({ min: a.original.waveform_min, max: a.original.waveform_max });
          } else {
            setGtWaveEnv(null);
          }
          if (Array.isArray(a?.target?.waveform_min) && Array.isArray(a?.target?.waveform_max)) {
            setSepWaveEnv({ min: a.target.waveform_min, max: a.target.waveform_max });
          } else {
            setSepWaveEnv(null);
          }
          if (a?.original?.spectrogram?.length) setGtSpectrum(a.original.spectrogram);
          if (a?.target?.spectrogram?.length) setSepSpectrum(a.target.spectrogram);
          if (Array.isArray(a?.original?.frequency_response)) {
            setGtFrequencyResponse(a.original.frequency_response);
          }
          if (Array.isArray(a?.target?.frequency_response)) {
            setSepFrequencyResponse(a.target.frequency_response);
          }
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
                  waveformEnv:
                    Array.isArray(d.waveform_min) && Array.isArray(d.waveform_max)
                      ? { min: d.waveform_min, max: d.waveform_max }
                      : st.waveformEnv || null,
                  spectrum: Array.isArray(d.spectrogram)
                    ? d.spectrogram
                    : st.spectrum,
                  frequencyResponse: Array.isArray(d.frequency_response) ? d.frequency_response : st.frequencyResponse,
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
      setSelectedAlgo(ALGO_NONE);
    } finally {
      setIsProcessing(false);
    }
  };

  const computeObjectiveMetrics = useCallback(async () => {
    const taskIdStr = typeof taskId === "string" ? taskId : taskId != null ? String(taskId) : "";
    const stemName = currentStem?.name;
    const refFile = gtFileRef.current;

    if (!taskIdStr) {
      showError("没有可用的任务ID，请先完成一次分离任务");
      return;
    }
    if (!stemName) {
      showError("请先选择需要评估的 stem");
      return;
    }
    if (!refFile) {
      showError("请先上传金标准参考音轨（Gold Standard Stem）再计算客观指标");
      return;
    }

    setObjectiveLoading(true);
    setObjectiveError(null);
    try {
      const form = new FormData();
      form.append("reference", refFile);
      const resp = await fetch(
        `${API_BASE}/api/tasks/${encodeURIComponent(taskIdStr)}/objective-metrics?target=${encodeURIComponent(stemName)}`,
        { method: "POST", body: form },
      );
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      const data = JSON.parse(text);

      const next = {
        sdr: typeof data?.sdr === "number" ? data.sdr : null,
        sir: typeof data?.sir === "number" ? data.sir : null,
        sar: typeof data?.sar === "number" ? data.sar : null,
        comment: data?.comment || "",
        target_stem: data?.target_stem || stemName,
        // 可选：SDR/SIR/SAR 的时间曲线（由后端返回），用于 SDR vs Time 可视化
        sdrCurve: Array.isArray(data?.sdr_curve) ? data.sdr_curve : null,
        sirCurve: Array.isArray(data?.sir_curve) ? data.sir_curve : null,
        sarCurve: Array.isArray(data?.sar_curve) ? data.sar_curve : null,
      };

      setObjectiveByStem((prev) => ({ ...(prev || {}), [stemName]: next }));
      // 兼容：仍然把最新值写回 results，避免其他地方只看 results
      setResults(next);
      showSuccess("客观指标计算完成");
    } catch (e) {
      console.error(e);
      const msg = e?.message || String(e);
      setObjectiveError(msg);
      showError(`客观指标计算失败：${msg}`);
    } finally {
      setObjectiveLoading(false);
    }
  }, [currentStem?.name, showError, showSuccess, taskId]);

  const submitScore = async () => {
    if (!user || !selectedAlgo || selectedAlgo === ALGO_NONE || !currentStem) {
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
    try {
      // 仅使用后端版本：直接写入数据库
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

        // 刷新“我的评分记录”列表
        fetchMyScores({ skip: 0, limit: 100 });
      }

      showSuccess("评分已提交并写入后端数据库！");
    } catch (e) {
      console.error(e);
      showError("提交失败，请重试");
    }
  };

  // 从算法对比统计中提取可用的 stem 名称，用于 Radar 下拉框
  const availableRadarStems = useMemo(() => {
    const stems = new Set();
    if (Array.isArray(algorithmComparison)) {
      algorithmComparison.forEach((algo) => {
        if (Array.isArray(algo.stem_breakdown)) {
          algo.stem_breakdown.forEach((stem) => {
            if (stem && stem.stem_name) {
              stems.add(stem.stem_name);
            }
          });
        }
      });
    }
    return ["ALL", ...Array.from(stems)];
  }, [algorithmComparison]);

  // Aggregated Stats for Chart（仅基于后端“全站”统计；不再混入本地浏览器历史评分）
  const radarModel = useMemo(() => {
    // 颜色映射（不在映射表内的算法用 fallback 配色）
    const COLOR = {
      "Demucs v4": "#06b6d4",
      Spleeter: "#8b5cf6",
      OpenUnmix: "#f59e0b",
      MDX23C: "#22c55e",
      Demucs4HT: "#38bdf8",
      "Band Split RoFormer": "#a78bfa",
      SCNet: "#fb7185",
      Unknown: "#94a3b8",
    };
    const FALLBACK = ["#06b6d4", "#8b5cf6", "#22c55e", "#f59e0b", "#fb7185", "#a78bfa"];

    const makeSeries = (keys) =>
      keys.map((k, idx) => ({
        key: k,
        color: COLOR[k] || FALLBACK[idx % FALLBACK.length],
      }));

    // 1) 使用后端聚合统计（真实“全站”数据，每 30s 刷新一次）
    if (Array.isArray(algorithmComparison) && algorithmComparison.length > 0) {
      const sorted = algorithmComparison
        .slice()
        .sort((x, y) => (y?.total_scores || 0) - (x?.total_scores || 0));

      const allAlgoNames = sorted.map((item) => item?.algorithm || "Unknown");

      // 用户显式选择的算法（只保留当前仍存在于后端数据中的）
      let effectiveSelection =
        Array.isArray(selectedRadarAlgorithms) && selectedRadarAlgorithms.length > 0
          ? selectedRadarAlgorithms.filter((name) => allAlgoNames.includes(name))
          : [];

      // 若未选择或选择失效，则默认展示前 2 名算法
      if (effectiveSelection.length === 0) {
        effectiveSelection = allAlgoNames.slice(0, 2);
      }

      // 建立算法名 -> 聚合统计 的映射，直接使用后端提供的平均分
      const statsByName = {};
      sorted.forEach((item) => {
        const name = item?.algorithm || "Unknown";
        statsByName[name] = {
          total_scores: item?.total_scores || 0,
          overall_avg_quality: item?.overall_avg_quality || 0,
          overall_avg_interference: item?.overall_avg_interference || 0,
          overall_avg_artifacts: item?.overall_avg_artifacts || 0,
          stem_breakdown: Array.isArray(item?.stem_breakdown)
            ? item.stem_breakdown
            : [],
        };
      });

      const metrics = [
        {
          subject: "Overall Quality",
          key: "overall_avg_quality",
        },
        {
          subject: "Interference Supp.",
          key: "overall_avg_interference",
        },
        {
          subject: "Artifacts",
          // 这里的 artifacts 在 UI 语义是“伪影控制”分数（越高越好），不要再做 100-x 的反转
          key: "overall_avg_artifacts",
        },
      ];

      const data = metrics.map((metric) => {
        const row = {
          subject: metric.subject,
          fullMark: 100,
        };
        effectiveSelection.forEach((algoName) => {
          const base = statsByName[algoName];
          if (!base) {
            row[algoName] = 0;
            return;
          }

          let source = base;
          // 若选择了特定 stem，则优先使用该 stem 的平均分
          if (
            selectedRadarStem &&
            selectedRadarStem !== "ALL" &&
            Array.isArray(base.stem_breakdown) &&
            base.stem_breakdown.length > 0
          ) {
            const stemStat = base.stem_breakdown.find(
              (s) => s.stem_name === selectedRadarStem,
            );
            if (stemStat) {
              source = {
                overall_avg_quality: stemStat.avg_quality,
                overall_avg_interference: stemStat.avg_interference,
                overall_avg_artifacts: stemStat.avg_artifacts,
              };
            }
          }

          row[algoName] = source ? source[metric.key] * 100 : 0;
        });
        return row;
      });

      return {
        source: "backend",
        total: sorted.reduce((sum, it) => sum + (it?.total_scores || 0), 0),
        series: makeSeries(effectiveSelection),
        data,
      };
    }

    // 2) 暂无后端统计：不再使用本地 localStorage 的历史评分伪装“全站数据”，让 UI 明确提示
    return { source: "empty", total: 0, series: [], data: [] };
  }, [algorithmComparison, selectedRadarAlgorithms, selectedRadarStem]);


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
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* 左侧 Logo 区域 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Activity className="text-cyan-400 flex-shrink-0" size={20} />
            <span className="font-bold text-xl tracking-tight whitespace-nowrap">
              Audio<span className="text-cyan-400">Lab</span>
            </span>
            <span className="ml-2 text-[10px] uppercase bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-slate-400 whitespace-nowrap flex-shrink-0">
              Beta v2.1
            </span>
          </div>

          {/* 中间导航菜单 */}
          <nav className="hidden lg:flex gap-1 bg-slate-800/50 p-1 rounded-lg border border-slate-700/50 flex-shrink-0">
            {[
              { id: "dashboard", label: "工作台", icon: Layers },
              { id: "history", label: "分离历史", icon: Clock },
              { id: "stats", label: "社区评估数据", icon: BarChart2 },
              { id: "audio_resources", label: "音频资源", icon: Music },
              { id: "comments", label: "社区评论", icon: User },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(VIEW_TO_PATH[item.id] || "/")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition whitespace-nowrap ${currentView === item.id ? "bg-cyan-600 text-white shadow-lg shadow-cyan-900/20" : "text-slate-400 hover:text-white hover:bg-slate-700"}`}
              >
                <item.icon size={14} className="flex-shrink-0" /> <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* 右侧功能区 */}
          <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
            {/* 设备状态 */}
            <div
              title="当前设备模式（由管理员在系统设置中配置）"
              className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/50 text-slate-300 whitespace-nowrap"
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  computeMode === "cpu" ? "bg-amber-400" : "bg-emerald-400"
                }`}
              ></span>
              <span className="text-xs font-bold tracking-wide">
                设备：{computeMode === "cpu" ? "CPU" : "GPU"}
              </span>
            </div>

            {/* 通知按钮 */}
            <button
              onClick={() => setShowNotificationCenter(true)}
              className="relative p-2 hover:bg-slate-800 rounded-lg transition flex-shrink-0"
              title="通知中心"
            >
              <Bell className="text-slate-400" size={20} />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                  {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                </span>
              )}
            </button>

            {/* 说明文档 */}
            <button
              type="button"
              onClick={() => setCurrentView("manual")}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-700/60 bg-slate-800/60 text-xs text-slate-200 hover:border-cyan-500/70 hover:text-white hover:bg-slate-800 transition flex-shrink-0"
              title="打开用户说明书"
            >
              <BookOpen size={14} className="text-cyan-400 flex-shrink-0" />
            </button>

            {/* 给管理员建议按钮（仅专家可见） */}
            {user?.role === "expert" && (
              <button
                onClick={() => setShowExpertMessageDialog(true)}
                className="hidden lg:inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-700/60 bg-slate-800/60 text-xs text-slate-200 hover:border-cyan-500/70 hover:text-white hover:bg-slate-800 transition flex-shrink-0"
                title="向管理员发送建议"
              >
                <MessageCircle size={14} className="text-cyan-400 flex-shrink-0" />
              </button>
            )}

            {/* 用户信息面板 */}
            <div className="flex-shrink-0">
              <AuthPanel
                user={user}
                onLogout={handleLogout}
                onClickUser={() => setShowUserProfileDialog(true)}
              />
            </div>
          </div>
        </div>
      </header>

      {showUserProfileDialog && user && authToken && (
        <UserProfileDialog
          user={user}
          token={authToken}
          onClose={() => setShowUserProfileDialog(false)}
          onUserUpdated={(updated) => {
            setUser(updated);
            setShowUserProfileDialog(false);
          }}
        />
      )}

      <main className="pt-24 pb-12 px-4 max-w-7xl mx-auto">
        {currentView === "manual" && (
          <UserManual onBack={() => setCurrentView("dashboard")} />
        )}
        {currentView === "dashboard" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Panel: Controls */}
            <div className="lg:col-span-4 space-y-6">
              {/* 历史记录 ID 一键导入（卡片上方的小工具栏，仅登录用户可见） */}
              {user && (
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col flex-1">
                      <span
                        className="text-xs font-semibold text-slate-200"
                        title="已完成的分离任务，可以直接通过 ID 导入结果，避免重复计算。"
                      >
                        历史记录 ID 导入
                      </span>
                    </div>
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={historyIdInput}
                        onChange={(e) => setHistoryIdInput(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                        placeholder="例如：177253401234567890"
                      />
                      <button
                        type="button"
                        disabled={historyImportLoading || !historyIdInput.trim()}
                        onClick={() => handleImportHistoryById()}
                        className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-xs font-medium text-white transition whitespace-nowrap"
                      >
                        {historyImportLoading ? "导入中..." : "按ID导入"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
                    {/*<p className="text-xs text-slate-400">*/}
                    {/*  为了便于在不同算法之间进行公平对比，目前仅支持从音频资源库中选择输入音频。*/}
                    {/*</p>*/}
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
                        setSelectedAlgo(ALGO_NONE);
                      }}
                      className="text-slate-500 hover:text-red-400"
                    >
                      <LogOut size={14} />
                    </button>
                  </div>
                )}
                {audioUrl && (
                  <div className="mt-2 overflow-hidden rounded-lg border border-slate-700/60 bg-slate-900/60">
                    <StemPlayer
                      name="Input Source"
                      src={audioUrl}
                      onSelect={() => {}}
                      theme="cyan"
                      showDownload={false}
                      syncedTime={syncedCurrentTime}
                      playbackRate={globalPlaybackRate}
                      onPlaybackRateChange={setGlobalPlaybackRate}
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
                          if (
                            goldStandardAudioRef.current &&
                            !goldStandardAudioRef.current.paused
                          ) {
                            goldStandardAudioRef.current.pause();
                            previousPlayingState.current.gold = false;
                          }
                          // 暂停分离结果播放器（先检查是否真的在播放）
                          if (
                            separatedStemAudioRef.current &&
                            !separatedStemAudioRef.current.paused
                          ) {
                            separatedStemAudioRef.current.pause();
                            previousPlayingState.current.separated = false;
                          }
                          // 暂停残差播放器
                          if (
                            residualStemAudioRef.current &&
                            !residualStemAudioRef.current.paused
                          ) {
                            residualStemAudioRef.current.pause();
                            previousPlayingState.current.residual = false;
                          }
                        }

                        handlePlayerStateChange("input", state);
                      }}
                    />
                  </div>
                )}
                  </>
                )}
              </div>

              {/* 我的分离历史卡片已移动到独立视图（history），此处不再展示 */}

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
                    {/*<p className="text-xs text-slate-400">*/}
                    {/*  为了确保能够在同一 Gold Standard 参考音轨上对比不同算法的表现，请从音频资源库中选择 Gold Standard Stem。*/}
                    {/*</p>*/}
                    <button
                      onClick={() => {
                        // 仅要求 1. Input Source 中已选择音频（无须强制成组 Mixture）
                        if (!rawFile && !audioUrl) {
                          showAlert("请先在 1. Input Source 中选择音频，然后再选择对应的 Gold Standard Stem。");
                          return;
                        }
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
                          setGoldWave(null);
                          setGoldWaveEnv(null);
                          setGoldSpectrum(null);
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
                          syncedTime={syncedCurrentTime}
                          playbackRate={globalPlaybackRate}
                          onPlaybackRateChange={setGlobalPlaybackRate}
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
                          // 暂停残差播放器
                          if (residualStemAudioRef.current && !residualStemAudioRef.current.paused) {
                            residualStemAudioRef.current.pause();
                            previousPlayingState.current.residual = false;
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
                    value={selectedAlgo || ALGO_NONE}
                    onChange={(e) => {
                      const algo = e.target.value;
                      setSelectedAlgo(algo);
                      if (algo === ALGO_NONE) return;
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
                        : selectedAlgo && selectedAlgo !== ALGO_NONE
                          ? "border-cyan-500 bg-slate-800 hover:border-cyan-400 hover:bg-slate-700/50 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                          : "border-slate-700 hover:border-slate-500 hover:bg-slate-700/50 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                    }`}
                    style={{
                      backgroundImage: "none",
                    }}
                  >
                    <option value={ALGO_NONE} className="bg-slate-800 text-slate-300">
                      无
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
                    {isProcessing && selectedAlgo && selectedAlgo !== ALGO_NONE ? (
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
                    <div className="mt-4 flex flex-col gap-2 text-xs text-slate-400">
                      <div className="flex items-center gap-2">
                        <div className="inline-block animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-cyan-400" />
                        <span className="flex items-center gap-2">
                          <Activity size={14} className="text-cyan-400 animate-pulse" />
                          {progressText || "处理中..."}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!taskId || isCancelling) return;
                            cancelSeparationRef.current.requested = true;
                            setIsCancelling(true);
                          }}
                          disabled={!taskId || isCancelling}
                          className={`inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                            !taskId || isCancelling
                              ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                              : "bg-red-500/90 hover:bg-red-500 text-white shadow-sm shadow-red-500/40"
                          }`}
                        >
                          {isCancelling ? "正在取消..." : "停止分离"}
                        </button>
                      </div>
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
                          syncedTime={syncedCurrentTime}
                          playbackRate={globalPlaybackRate}
                          onPlaybackRateChange={setGlobalPlaybackRate}
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
                              // 暂停残差播放器
                              if (residualStemAudioRef.current && !residualStemAudioRef.current.paused) {
                                residualStemAudioRef.current.pause();
                                previousPlayingState.current.residual = false;
                              }
                            }
                            
                            handlePlayerStateChange("stem", state);
                          }}
                        />
                      </div>
                      {/* Residual Player: Mix - Alg，用于听剩余干扰与伪影 */}
                      <div className="mt-3 space-y-1">
                        <div className="text-[11px] text-slate-500">
                          残差播放器 <span className="font-mono text-slate-300">Residual (Mix - Alg)</span>：用于听剩余干扰与伪影。
                        </div>
                        {taskId && (
                          <div className="overflow-hidden rounded-lg border border-slate-700/60 bg-slate-900/60">
                            <StemPlayer
                              name={`${currentStem.name} Residual`}
                              src={
                                typeof taskId === "string"
                                  ? `${API_BASE}/api/tasks/${encodeURIComponent(taskId)}/residual?target=${encodeURIComponent(currentStem.name)}`
                                  : `${API_BASE}/api/tasks/${encodeURIComponent(String(taskId))}/residual?target=${encodeURIComponent(currentStem.name)}`
                              }
                              onSelect={() => {}}
                              syncedTime={syncedCurrentTime}
                              playbackRate={globalPlaybackRate}
                              onPlaybackRateChange={setGlobalPlaybackRate}
                              onUserSeek={(t) => seekAll(t)}
                              onPlaybackStateChange={(state) => {
                                const wasPlaying = previousPlayingState.current.residual;
                                const isNowPlaying = state.playing;

                                previousPlayingState.current.residual = isNowPlaying;
                                residualStemAudioRef.current = state.audioRef;

                                if (isNowPlaying && !wasPlaying) {
                                  if (inputSourceAudioRef.current && !inputSourceAudioRef.current.paused) {
                                    inputSourceAudioRef.current.pause();
                                    previousPlayingState.current.input = false;
                                  }
                                  if (goldStandardAudioRef.current && !goldStandardAudioRef.current.paused) {
                                    goldStandardAudioRef.current.pause();
                                    previousPlayingState.current.gold = false;
                                  }
                                  if (separatedStemAudioRef.current && !separatedStemAudioRef.current.paused) {
                                    separatedStemAudioRef.current.pause();
                                    previousPlayingState.current.separated = false;
                                  }
                                }

                                // 残差播放器不作为“主时间轴”的 driver，只同步进度
                              }}
                            />
                          </div>
                        )}

                        {/* 自定义残差 / 混合播放器 */}
                        {stems && stems.length > 0 && (
                          <div className="mt-4 space-y-2 bg-slate-900/60 border border-slate-700/60 rounded-lg p-3">
                            <div className="flex items-center justify-between text-[11px] text-slate-400">
                              <div>
                                残差 / 自定义混合播放器
                                <span className="ml-1 font-mono text-slate-300">
                                  ({mixMode === "remove" ? "消除所选声源" : "只保留所选声源"})
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setMixMode("remove")}
                                  className={`px-2 py-0.5 rounded border text-[10px] ${
                                    mixMode === "remove"
                                      ? "border-cyan-500 text-cyan-300 bg-cyan-500/10"
                                      : "border-slate-600 text-slate-400 bg-slate-800/60 hover:bg-slate-700/80"
                                  }`}
                                >
                                  消除这些
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setMixMode("keep")}
                                  className={`px-2 py-0.5 rounded border text-[10px] ${
                                    mixMode === "keep"
                                      ? "border-emerald-500 text-emerald-300 bg-emerald-500/10"
                                      : "border-slate-600 text-slate-400 bg-slate-800/60 hover:bg-slate-700/80"
                                  }`}
                                >
                                  只保留这些
                                </button>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2 text-[11px]">
                              {stems.map((s) => {
                                const checked = mixSelectedStems.includes(s.name);
                                return (
                                  <label
                                    key={s.name}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border cursor-pointer ${
                                      checked
                                        ? "border-cyan-500 text-cyan-200 bg-cyan-500/10"
                                        : "border-slate-600 text-slate-400 bg-slate-800/60 hover:bg-slate-700/80"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="accent-cyan-500"
                                      checked={checked}
                                      onChange={(e) => {
                                        setMixSelectedStems((prev) => {
                                          const prevArr = Array.isArray(prev) ? prev : [];
                                          if (e.target.checked) {
                                            return Array.from(new Set([...prevArr, s.name]));
                                          }
                                          return prevArr.filter((x) => x !== s.name);
                                        });
                                      }}
                                    />
                                    <span className="font-mono">{s.name}</span>
                                  </label>
                                );
                              })}
                            </div>

                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={generateMixedAudio}
                                disabled={
                                  mixLoading ||
                                  !taskId ||
                                  !mixSelectedStems ||
                                  mixSelectedStems.length === 0
                                }
                                className={`px-3 py-1.5 rounded text-[11px] font-mono border transition ${
                                  mixLoading ||
                                  !taskId ||
                                  !mixSelectedStems ||
                                  mixSelectedStems.length === 0
                                    ? "border-slate-700 text-slate-600 bg-slate-900/40 cursor-not-allowed"
                                    : "border-cyan-600/60 text-cyan-300 bg-cyan-600/10 hover:bg-cyan-600/20"
                                }`}
                              >
                                {mixLoading ? "生成中..." : "生成混合音频"}
                              </button>
                              {mixError && (
                                <span className="text-[11px] text-red-300 truncate max-w-xs">
                                  {mixError}
                                </span>
                              )}
                            </div>

                            {mixAudioFile && (
                              <div className="mt-2 overflow-hidden rounded-lg border border-slate-700/60 bg-slate-900/60">
                                <StemPlayer
                                  name={
                                    mixMode === "remove"
                                      ? "Residual Mix (消除所选声源)"
                                      : "Custom Mix (只保留所选声源)"
                                  }
                                  file={mixAudioFile}
                                  onSelect={() => {}}
                                  syncedTime={syncedCurrentTime}
                                  playbackRate={globalPlaybackRate}
                                  onPlaybackRateChange={setGlobalPlaybackRate}
                                  onUserSeek={(t) => seekAll(t)}
                                  onPlaybackStateChange={() => {
                                    // 混合播放器只同步进度，不驱动主时间轴互斥逻辑
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                )}
              </div>

              {/* Objective Metrics (Show after process) */}
              {(results || (stems && stems.length > 0)) && (
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
                  <div>
              <div className="flex items-center gap-4 text-xs text-slate-400 mb-3">
                <div>
                  算法:{" "}
                  <span className="font-mono text-cyan-400">
                    {selectedAlgo && selectedAlgo !== ALGO_NONE ? selectedAlgo : "无"}
                  </span>
                </div>
                <div>
                  评估 Stem: <span className="font-mono text-cyan-400">{currentStem?.name || "未选择"}</span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {!gtFileRef.current ? (
                    <span className="text-slate-500">
                      未上传金标准参考音轨，SDR/SIR 将无法计算
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      已上传金标准，可计算 SDR/SIR/SAR
                    </span>
                  )}
                  <button
                    onClick={computeObjectiveMetrics}
                    disabled={
                      objectiveLoading || !taskId || !currentStem?.name || !gtFileRef.current
                    }
                    className={`px-3 py-1 rounded border text-[11px] font-mono transition ${
                      objectiveLoading || !taskId || !currentStem?.name || !gtFileRef.current
                        ? "border-slate-700 text-slate-600 bg-slate-900/40 cursor-not-allowed"
                        : "border-cyan-600/60 text-cyan-300 bg-cyan-600/10 hover:bg-cyan-600/20"
                    }`}
                    title="上传 Gold Standard Stem 后，点击计算 SDR/SIR/SAR"
                  >
                    {objectiveLoading ? "计算中..." : "计算指标"}
                  </button>
                </div>
              </div>
              {objectiveError ? (
                <div className="mb-3 text-xs text-red-300 bg-red-900/20 border border-red-700/40 rounded px-3 py-2">
                  {objectiveError}
                </div>
              ) : null}
                  <div className="space-y-4">
                    <div>
                      {(() => {
                        const key = currentStem?.name;
                        const cached =
                          key && objectiveByStem?.[key] ? objectiveByStem[key] : null;
                        const last =
                          results &&
                          (!key || !results.target_stem || results.target_stem === key)
                            ? results
                            : null;
                        const m = cached || last || {};

                        const fmtDb = (v) =>
                          typeof v === "number" && isFinite(v) ? v.toFixed(2) : "N/A";

                        const clamp01 = (x) => Math.max(0, Math.min(1, x));
                        const sdrNorm = clamp01((m.sdr || 0) / 15);
                        const sirNorm = clamp01((m.sir || 0) / 20);
                        const sarNorm = clamp01((m.sar || 0) / 20);

                        // SDR vs Time：如果后端返回 sdr_curve，则构造按时间采样的折线数据
                        let sdrCurveData = null;
                        if (Array.isArray(m.sdrCurve) && m.sdrCurve.length > 1) {
                          const n = m.sdrCurve.length;
                          const duration =
                            typeof syncedDuration === "number" && syncedDuration > 0
                              ? syncedDuration
                              : n; // 若未知时长，则时间轴用索引代替
                          sdrCurveData = m.sdrCurve.map((val, idx) => {
                            const pos = n > 1 ? idx / (n - 1) : 0;
                            const tSec = duration * pos;
                            return {
                              time: Number.isFinite(tSec) ? Number(tSec.toFixed(2)) : idx,
                              sdr: typeof val === "number" && isFinite(val) ? val : null,
                            };
                          });
                        }

                        return (
                          <>
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-slate-400">
                                  SDR (Signal-to-Distortion)
                                </span>
                                <span className="text-emerald-400 font-mono">
                                  {fmtDb(m.sdr)} dB
                                </span>
                              </div>
                              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 transition-all"
                                  style={{ width: `${sdrNorm * 100}%` }}
                                ></div>
                              </div>
                            </div>

                            <div>
                              <div className="flex justify-between text-xs mb-1 mt-3">
                                <span className="text-slate-400">
                                  SIR (Signal-to-Interference)
                                </span>
                                <span className="text-blue-400 font-mono">
                                  {fmtDb(m.sir)} dB
                                </span>
                              </div>
                              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 transition-all"
                                  style={{ width: `${sirNorm * 100}%` }}
                                ></div>
                              </div>
                            </div>

                            <div>
                              <div className="flex justify-between text-xs mb-1 mt-3">
                                <span className="text-slate-400">
                                  SAR (Signal-to-Artifacts)
                                </span>
                                <span className="text-amber-300 font-mono">
                                  {fmtDb(m.sar)} dB
                                </span>
                              </div>
                              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-amber-400 transition-all"
                                  style={{ width: `${sarNorm * 100}%` }}
                                ></div>
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                <span className="mr-2">
                                  SDR：整体失真程度（越高越接近金标准）
                                </span>
                                <span className="mr-2">
                                  SIR：串音/干扰抑制能力（越高越干净）
                                </span>
                                <span>
                                  SAR：伪影控制能力（越高说明“水声”“机械噪声”等越少）
                                </span>
                              </div>
                            </div>

                            {sdrCurveData && (
                              <div className="mt-4">
                                <div className="flex justify-between items-center mb-1 text-xs">
                                  <span className="text-slate-400">
                                    SDR vs Time
                                  </span>
                                  <span className="font-mono text-slate-500">
                                    Stem:{" "}
                                    <span className="text-cyan-300">
                                      {currentStem?.name || "N/A"}
                                    </span>
                                  </span>
                                </div>
                                <div className="h-28 bg-slate-900 rounded border border-slate-700/60 px-2 py-1.5">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={sdrCurveData}>
                                      <CartesianGrid
                                        stroke="#1e293b"
                                        strokeDasharray="3 3"
                                        vertical={false}
                                      />
                                      <XAxis
                                        dataKey="time"
                                        tickFormatter={(v) =>
                                          typeof v === "number" ? v.toFixed(1) : v
                                        }
                                        tick={{ fontSize: 9, fill: "#9ca3af" }}
                                        axisLine={{ stroke: "#4b5563" }}
                                        label={{
                                          value: "Time (s)",
                                          position: "insideRight",
                                          offset: -4,
                                          style: { fill: "#6b7280", fontSize: 9 },
                                        }}
                                      />
                                      <YAxis
                                        tick={{ fontSize: 9, fill: "#9ca3af" }}
                                        axisLine={{ stroke: "#4b5563" }}
                                        tickFormatter={(v) =>
                                          typeof v === "number" ? v.toFixed(1) : v
                                        }
                                        label={{
                                          value: "SDR (dB)",
                                          angle: -90,
                                          position: "insideLeft",
                                          style: { fill: "#6b7280", fontSize: 9 },
                                        }}
                                      />
                                      <RechartsTooltip
                                        contentStyle={{
                                          backgroundColor: "#020617",
                                          border: "1px solid #1f2937",
                                          fontSize: 11,
                                        }}
                                        formatter={(value) =>
                                          typeof value === "number"
                                            ? `${value.toFixed(2)} dB`
                                            : value
                                        }
                                        labelFormatter={(label) =>
                                          typeof label === "number"
                                            ? `${label.toFixed(2)} s`
                                            : label
                                        }
                                      />
                                      <Legend
                                        verticalAlign="top"
                                        height={16}
                                        wrapperStyle={{
                                          paddingBottom: 4,
                                          fontSize: 10,
                                          color: "#9ca3af",
                                        }}
                                      />
                                      <Line
                                        type="monotone"
                                        dataKey="sdr"
                                        name="SDR(t)"
                                        stroke="#22c55e"
                                        strokeWidth={1.5}
                                        dot={false}
                                        isAnimationActive={false}
                                      />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>
                            )}

                            <div className="p-3 bg-slate-800 rounded border border-slate-600 text-xs text-slate-300 mt-4 leading-relaxed">
                              <span className="text-cyan-400 font-bold">
                                AI Summary:
                              </span>{" "}
                              {m.comment || (results && results.comment) || ""}
                            </div>
                          </>
                        );
                      })()}
                  </div>
                  </div>
                  </div>
                )}
                </div>
              )}
            </div>

            {/* Center & Right Panel: Visualization & Evaluation */}
            <div className="lg:col-span-8 space-y-6">
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
                <div className="p-4 space-y-6">
                  {/* Processing Overlay */}
                  {isProcessing && (
                    <div className="absolute inset-0 bg-slate-900/80 z-20 flex flex-col items-center justify-center backdrop-blur-sm">
                      <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                      <p className="text-cyan-400 font-mono animate-pulse">
                        Running Neural Inference...
                      </p>
                      <p className="text-slate-500 text-xs mt-2">
                        Model: {selectedAlgo && selectedAlgo !== ALGO_NONE ? selectedAlgo : "None"}
                      </p>
                    </div>
                  )}

                  {/* Waveform Comparison：两个波形图放在一起（Gold/Mix vs Separated） */}
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                        波形对比 · Waveform Comparison
                      </span>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400">
                        <label className="flex items-center gap-2 cursor-pointer select-none hover:text-slate-300 transition">
                          <input
                            type="checkbox"
                            checked={waveAutoGain}
                            onChange={(e) => setWaveAutoGain(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-2 focus:ring-cyan-500/20 focus:ring-offset-0 focus:ring-offset-slate-900 cursor-pointer"
                          />
                          <span>自动增益</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Y 缩放</span>
                          <input
                            type="range"
                            min="0.5"
                            max="5"
                            step="0.1"
                            value={waveYZoom}
                            onChange={(e) => setWaveYZoom(parseFloat(e.target.value))}
                            className="w-32 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                          />
                          <span className="font-mono text-slate-300 w-10 text-right">
                            {Number(waveYZoom).toFixed(1)}x
                          </span>
                        </div>
                        <button
                          onClick={() => setWaveExpanded((v) => !v)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700/70 text-slate-200 transition"
                          title={waveExpanded ? "收起波形图" : "展开波形图"}
                        >
                          {waveExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                          <span>{waveExpanded ? "收起" : "展开"}</span>
                        </button>
                      </div>
                    </div>

                    {/* 电平对比（参考 / 分离） */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <LevelMeter
                        wave={goldWaveEnv || goldWave || gtWaveEnv || gtWave}
                        playbackState={playbackState}
                        label={gtFileRef.current ? "Gold Level" : "Mix Level"}
                        theme="emerald"
                      />
                      <LevelMeter
                        wave={
                          currentStem?.waveformEnv
                            ? currentStem.waveformEnv
                            : currentStem?.waveform
                              ? currentStem.waveform
                              : results
                                ? (sepWaveEnv || sepWave)
                                : []
                        }
                        playbackState={playbackState}
                        label="Separated Level"
                        theme="cyan"
                      />
                    </div>

                    <div className="space-y-3 pt-1">
                      {/* 参考波形：Gold Standard（若有）或 Mixture */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-mono text-emerald-300">
                            Reference
                          </span>
                      <span className="text-slate-500">
                        {gtFileRef.current ? "Gold Standard Stem" : "暂无 Gold Standard（尚未选择）"}
                      </span>
                        </div>
                        <SingleWaveformView
                      wave={goldWaveEnv || goldWave || []}
                          heightPx={waveExpanded ? 200 : 140}
                          autoGain={waveAutoGain}
                          yZoom={waveYZoom}
                          viewRange={viewRange}
                          playbackState={playbackState}
                        />
                      </div>

                      {/* 分离结果波形 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-mono text-cyan-300">
                            Separated
                          </span>
                          <span className="text-slate-500">
                            {currentStem?.name || "未选择 Stem"}
                          </span>
                        </div>
                        <SingleWaveformView
                          wave={
                            currentStem?.waveformEnv
                              ? currentStem.waveformEnv
                              : currentStem?.waveform
                                ? currentStem.waveform
                                : results
                                  ? (sepWaveEnv || sepWave)
                                  : []
                          }
                          heightPx={waveExpanded ? 200 : 140}
                          autoGain={waveAutoGain}
                          yZoom={waveYZoom}
                          viewRange={viewRange}
                          playbackState={playbackState}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Spectrum Comparison：两个频谱瀑布图放在一起（Mix vs Separated） */}
                  <div className="space-y-3 pt-4 border-t border-slate-800/80">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                        频谱对比 · Spectrogram / 语谱图
                      </span>
                      <div className="text-[11px] text-slate-500">
                        参考频谱仅展示 Gold Standard Stem，若暂无则留空不显示。
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-mono text-emerald-300">
                            Reference Spectrogram
                          </span>
                          <span className="text-slate-500">
                            {goldSpectrum ? "Gold Standard Stem" : "暂无 Gold Standard 频谱"}
                          </span>
                        </div>
                        <div className="space-y-2">
                          <SingleSpectrogramView
                            spectrum={goldSpectrum || []}
                            heightPx={220}
                            viewRange={viewRange}
                            onViewRangeChange={setViewRange}
                            playbackState={playbackState}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-mono text-cyan-300">
                            Separated Spectrogram
                          </span>
                          <span className="text-slate-500">
                            {currentStem?.name || "未选择 Stem"}
                          </span>
                        </div>
                        <div className="space-y-2">
                          <SingleSpectrogramView
                            spectrum={currentStem?.spectrum || sepSpectrum}
                            heightPx={220}
                            viewRange={viewRange}
                            onViewRangeChange={setViewRange}
                            playbackState={playbackState}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-center">
                      <div className="text-xs text-slate-400 bg-slate-800/30 px-3 py-1.5 rounded border border-slate-700/30">
                        <span className="mr-4">点击任一波形/语谱图 → 跳转播放位置（参考与分离同步）</span>
                        <span>在频谱上拖拽选择 → 缩放时间窗，双击还原</span>
                      </div>
                    </div>
                  </div>

                  {/* Frequency Analysis Plot：频率分析图对比 */}
                  <div className="space-y-3 pt-4 border-t border-slate-800/80">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                        频率分析对比 · Frequency Analysis Plot
                      </span>
                      <div className="text-[11px] text-slate-500">
                        标准音频（蓝色实线）vs 分离音频（红色虚线）
                      </div>
                    </div>

                    <FrequencyAnalysisPlot
                      isActive={!!(results && (
                        (Array.isArray(goldFrequencyResponse) && goldFrequencyResponse.length > 0) ||
                        (Array.isArray(sepFrequencyResponse) && sepFrequencyResponse.length > 0) ||
                        (currentStem?.frequencyResponse && Array.isArray(currentStem.frequencyResponse) && currentStem.frequencyResponse.length > 0)
                      ))}
                      originalFrequencyResponse={Array.isArray(goldFrequencyResponse) ? goldFrequencyResponse : []}
                      separatedFrequencyResponse={currentStem?.frequencyResponse || sepFrequencyResponse || []}
                      sampleRate={audioMetadata.sampleRate || 44100}
                      nFreqBins={128}
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
                          {selectedAlgo && selectedAlgo !== ALGO_NONE ? selectedAlgo : "无"}
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
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.max(0, (currentScore[m.key] ?? 0) - 1);
                                  setStemScores((prev) => ({
                                    ...prev,
                                    [stemName]: {
                                      ...(prev[stemName] || currentScore),
                                      [m.key]: next,
                                    },
                                  }));
                                }}
                                disabled={!results || !currentStem}
                                className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                -
                              </button>
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
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.min(100, (currentScore[m.key] ?? 0) + 1);
                                  setStemScores((prev) => ({
                                    ...prev,
                                    [stemName]: {
                                      ...(prev[stemName] || currentScore),
                                      [m.key]: next,
                                    },
                                  }));
                                }}
                                disabled={!results || !currentStem}
                                className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                +
                              </button>
                            </div>
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
                      <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">
                        实时评分统计 (Radar)
                      </h4>
                      {radarModel.source === "empty" && (
                        <div className="text-xs text-slate-500 mb-2">
                          暂无专家评分数据（提交评分后会自动显示聚合结果）
                        </div>
                      )}
                      {radarModel.source !== "empty" && (
                        <>
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-2">
                            <div className="text-[11px] text-slate-500 text-left space-y-1.5">
                              <div>
                                数据源：
                                {radarModel.source === "backend"
                                  ? `后端统计（共 ${radarModel.total} 份评分，约每30秒刷新）`
                                  : `本地浏览器（共 ${radarModel.total} 份评分）`}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span>声源：</span>
                                <select
                                  value={selectedRadarStem}
                                  onChange={(e) =>
                                    setSelectedRadarStem(e.target.value)
                                  }
                                  className="bg-slate-900/80 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                >
                                  {availableRadarStems.map((stem) => (
                                    <option key={stem} value={stem}>
                                      {stem === "ALL"
                                        ? "全部声源（总体）"
                                        : stem}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                当前算法：
                                <span className="text-slate-300">
                                  {Array.isArray(selectedRadarAlgorithms) &&
                                  selectedRadarAlgorithms.length > 0
                                    ? selectedRadarAlgorithms.join(" / ")
                                    : "默认对比前 2 名算法"}
                                </span>
                              </div>
                            </div>
                            {Array.isArray(algorithmComparison) &&
                              algorithmComparison.length > 0 && (
                                <div className="flex flex-col items-stretch text-left">
                                  <span className="text-[10px] text-slate-400 mb-1">
                                    选择算法（竖排按钮，可多选叠加）
                                  </span>
                                  <div className="flex flex-col gap-1">
                                    {algorithmComparison
                                      .slice()
                                      .sort(
                                        (a, b) =>
                                          (b?.total_scores || 0) -
                                          (a?.total_scores || 0),
                                      )
                                      .slice(0, 4)
                                      .map((algo) => {
                                        const name =
                                          algo?.algorithm || "Unknown";
                                        const count =
                                          algo?.total_scores || 0;
                                        const isActive =
                                          selectedRadarAlgorithms.includes(
                                            name,
                                          );
                                        const COLOR = {
                                          "Demucs v4": "#06b6d4",
                                          Spleeter: "#8b5cf6",
                                          OpenUnmix: "#f59e0b",
                                          MDX23C: "#22c55e",
                                          Demucs4HT: "#38bdf8",
                                          "Band Split RoFormer": "#a78bfa",
                                          SCNet: "#fb7185",
                                          Unknown: "#94a3b8",
                                        };
                                        const FALLBACK = [
                                          "#06b6d4",
                                          "#8b5cf6",
                                          "#22c55e",
                                          "#f59e0b",
                                          "#fb7185",
                                          "#a78bfa",
                                        ];
                                        const baseColor =
                                          COLOR[name] ||
                                          FALLBACK[
                                            name.length % FALLBACK.length
                                          ];
                                        return (
                                          <button
                                            key={name}
                                            type="button"
                                            onClick={() => {
                                              setSelectedRadarAlgorithms(
                                                (prev) => {
                                                  if (prev.includes(name)) {
                                                    return prev.filter(
                                                      (x) => x !== name,
                                                    );
                                                  }
                                                  return [...prev, name];
                                                },
                                              );
                                            }}
                                            className={`w-full px-2 py-1 rounded-full border text-[11px] text-left transition-colors ${
                                              isActive
                                                ? "bg-slate-900/80 text-slate-50"
                                                : "bg-slate-900/40 text-slate-200 hover:bg-slate-800/80"
                                            }`}
                                            style={{
                                              borderColor: baseColor,
                                              boxShadow: isActive
                                                ? `0 0 0 1px ${baseColor}55`
                                                : "none",
                                            }}
                                          >
                                            <span
                                              className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                                              style={{
                                                backgroundColor: baseColor,
                                              }}
                                            />
                                            <span className="align-middle">
                                              {name}（{count}）
                                            </span>
                                          </button>
                                        );
                                      })}
                                  </div>
                                </div>
                              )}
                          </div>
                        </>
                      )}
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart
                          cx="50%"
                          cy="50%"
                          outerRadius="80%"
                          data={radarModel.data}
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
                          {radarModel.series.map((s) => (
                            <Radar
                              key={s.key}
                              name={s.key}
                              dataKey={s.key}
                              stroke={s.color}
                              fill={s.color}
                              fillOpacity={0.28}
                            />
                          ))}
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

        {/* 我的分离历史独立页面 */}
        {currentView === "history" && user && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Clock size={18} className="text-cyan-400" />
                  我的分离历史
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  查看和管理你过去创建的音频分离任务，可以按任务ID快速导入结果或删除历史记录。
                </p>
              </div>
              <button
                type="button"
                onClick={() => fetchMyTaskHistory(1)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-100 flex items-center gap-2"
              >
                <RotateCcw size={14} />
                刷新
              </button>
            </div>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    按任务 ID 搜索
                  </label>
                  <input
                    type="text"
                    value={historyIdInput}
                    onChange={(e) => setHistoryIdInput(e.target.value)}
                    placeholder="精确输入任务ID，例如：177253401234567890"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                  />
                </div>
                <div className="md:col-span-2 flex items-end gap-2">
                  <button
                    type="button"
                    disabled={historyImportLoading || !historyIdInput.trim()}
                    onClick={() => handleImportHistoryById()}
                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-xs font-medium text-white transition"
                  >
                    {historyImportLoading ? "按ID导入中..." : "按ID导入任务"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryIdInput("");
                      fetchMyTaskHistory(1);
                    }}
                    className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-medium text-slate-100"
                  >
                    清空条件
                  </button>
                </div>
              </div>
            </div>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              {myTaskHistoryError ? (
                <div className="mb-4 text-xs text-red-200 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">
                  加载失败：{myTaskHistoryError}
                </div>
              ) : null}
              {myTaskHistoryLoading ? (
                <div className="text-center text-slate-400 py-8 text-sm">
                  加载中...
                </div>
              ) : myTaskHistory.length === 0 ? (
                <div className="text-center text-slate-400 py-10 text-sm space-y-3">
                  <div>
                    {myTaskHistoryError
                      ? "历史记录加载失败，请稍后重试。"
                      : "暂无历史记录，先在工作台执行一次分离任务。"}
                  </div>
                  {!myTaskHistoryError && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        disabled={claimAnonymousLoading}
                        onClick={() => handleClaimAnonymousHistory()}
                        className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium text-slate-100"
                      >
                        {claimAnonymousLoading ? "找回中..." : "找回匿名历史"}
                      </button>
                      <div className="text-[11px] text-slate-500">
                        如果你之前的任务是在未携带登录 token 的情况下创建的，会被记为 anonymous，可通过此按钮找回。
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-900">
                        <tr>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">
                            任务ID
                          </th>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">
                            文件名
                          </th>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">
                            算法
                          </th>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">
                            状态
                          </th>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">
                            创建时间
                          </th>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700">
                        {myTaskHistory.map((t) => (
                          <tr key={t.id} className="hover:bg-slate-700/40">
                            <td className="px-3 py-2 font-mono text-slate-200">
                              {t.id}
                            </td>
                            <td className="px-3 py-2 text-slate-100 max-w-xs truncate">
                              {t.original_filename || "(未命名音频)"}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {t.algorithm || "-"}
                            </td>
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
                              {t.created_at
                                ? new Date(t.created_at).toLocaleString("zh-CN")
                                : "-"}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[11px]"
                                  onClick={() => {
                                    setHistoryIdInput(String(t.id));
                                    handleImportHistoryById();
                                  }}
                                >
                                  导入
                                </button>
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded bg-slate-700 hover:bg-red-600 text-white text-[11px]"
                                  onClick={() => handleDeleteHistoryTask(t.id)}
                                >
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {myTaskHistoryTotalPages > 1 && (
                    <div className="flex items-center justify-between mt-4 text-[11px] text-slate-400">
                      <button
                        type="button"
                        disabled={myTaskHistoryPage <= 1}
                        onClick={() =>
                          fetchMyTaskHistory(myTaskHistoryPage - 1)
                        }
                        className="px-3 py-1.5 rounded bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        上一页
                      </button>
                      <span>
                        第 {myTaskHistoryPage} / {myTaskHistoryTotalPages} 页
                      </span>
                      <button
                        type="button"
                        disabled={myTaskHistoryPage >= myTaskHistoryTotalPages}
                        onClick={() =>
                          fetchMyTaskHistory(myTaskHistoryPage + 1)
                        }
                        className="px-3 py-1.5 rounded bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        下一页
                      </button>
                    </div>
                  )}
                </>
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
                {backendStats.length > 0 ? (
                  <>
                    基于{" "}
                    {backendStats.reduce((sum, s) => sum + (s.total_scores || 0), 0)}
                    {" "}
                    份专家评估报告生成的汇总数据。
                    <span className="ml-2 text-cyan-400">
                      （
                      {backendStats.reduce(
                        (sum, s) => sum + (s.unique_experts || 0),
                        0,
                      )}
                      {" "}
                      位专家参与）
                    </span>
                  </>
                ) : (
                  <>暂未有后端专家评分统计数据，等待专家提交评分后自动汇总。</>
                )}
              </p>
              {loadingStats && (
                <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
                  <Activity size={12} className="animate-pulse" />
                  正在加载统计数据...
                </div>
              )}
            </div>

            {/* 当前专家：我的评分记录（支持删除单条手滑记录） */}
            {user?.role === "expert" && (
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-white">我的评分记录（可删除单条记录）</h3>
                  <button
                    onClick={() => fetchMyScores({ skip: 0, limit: 100 })}
                    className="px-3 py-1.5 rounded border border-slate-600 text-xs text-slate-200 hover:bg-slate-700/50 transition"
                    disabled={loadingMyScores}
                    title="从后端刷新我的评分记录"
                  >
                    {loadingMyScores ? "刷新中..." : "刷新"}
                  </button>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  说明：这里展示的是<strong>后端数据库</strong>中的评分记录。点击“删除”会从后端移除该条评分，并尽量同步清理本地缓存。
                </p>
                {myScoresError ? (
                  <div className="mb-4 text-xs text-red-300 bg-red-900/20 border border-red-700/40 rounded px-3 py-2">
                    加载失败：{myScoresError}
                  </div>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-400">
                        <th className="py-2 pr-4">时间</th>
                        <th className="py-2 pr-4">Algorithm</th>
                        <th className="py-2 pr-4">Stem</th>
                        <th className="py-2 pr-4 text-right">Quality</th>
                        <th className="py-2 pr-4 text-right">Interference</th>
                        <th className="py-2 pr-4 text-right">Artifacts</th>
                        <th className="py-2 pr-4">TaskID</th>
                        <th className="py-2 pr-4 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingMyScores && myScoreRecords.length === 0 ? (
                        <tr>
                          <td className="py-4 text-center text-slate-500" colSpan={8}>
                            正在加载...
                          </td>
                        </tr>
                      ) : myScoreRecords.length === 0 ? (
                        <tr>
                          <td className="py-4 text-center text-slate-500" colSpan={8}>
                            暂无评分记录（你提交主观评分后会出现在这里）
                          </td>
                        </tr>
                      ) : (
                        myScoreRecords.map((row, idx) => (
                          <tr
                            key={String(row?.id || idx)}
                            className="border-b border-slate-800 hover:bg-slate-900/60 transition"
                          >
                            <td className="py-2 pr-4 text-slate-300 font-mono">
                              {row?.created_at ? String(row.created_at).replace("T", " ").slice(0, 19) : "-"}
                            </td>
                            <td className="py-2 pr-4 text-slate-200">{row?.algorithm || "-"}</td>
                            <td className="py-2 pr-4 text-slate-300">{row?.stem_name || "ALL"}</td>
                            <td className="py-2 pr-4 text-right text-emerald-400 font-mono">{row?.quality ?? "-"}</td>
                            <td className="py-2 pr-4 text-right text-cyan-400 font-mono">{row?.interference ?? "-"}</td>
                            <td className="py-2 pr-4 text-right text-orange-400 font-mono">{row?.artifacts ?? "-"}</td>
                            <td className="py-2 pr-4 text-slate-500 font-mono">{row?.task_id ?? "-"}</td>
                            <td className="py-2 pr-4 text-right">
                              <button
                                onClick={() => deleteMyScoreRecord(row)}
                                className="px-2 py-1 rounded border border-red-700/50 text-red-300 hover:bg-red-900/20 transition"
                                title="删除该条评分记录"
                              >
                                删除
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

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
                    {backendStats.length === 0 ? (
                      <tr>
                        <td
                          className="py-4 text-center text-slate-500"
                          colSpan={7}
                        >
                          {loadingStats ? "正在加载数据..." : "暂无评分数据，请在工作台中对不同 stem 提交评估。"}
                        </td>
                      </tr>
                    ) : (
                      backendStats.map((row) => (
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
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    value={commentsAlgorithmFilter}
                    onChange={(e) => setCommentsAlgorithmFilter(e.target.value)}
                  >
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
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    value={commentsStemFilter}
                    onChange={(e) => setCommentsStemFilter(e.target.value)}
                  >
                    <option value="">全部 Stem</option>
                    <option value="Vocals">Vocals</option>
                    <option value="Drums">Drums</option>
                    <option value="Bass">Bass</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 统计概览卡片（根据筛选条件过滤） */}
            {filteredBackendStatsForComments.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {ALGORITHMS.slice(0, 4).map((algo) => {
                  const algoStats = filteredBackendStatsForComments.filter(
                    (s) => s.algorithm === algo,
                  );
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
                    {filteredAlgorithmComparison.map((algo) => (
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

      {/* 专家给管理员的建议对话框 */}
      {showExpertMessageDialog && (
        <ExpertMessageDialog
          token={authToken}
          onClose={() => setShowExpertMessageDialog(false)}
        />
      )}

      {/* 音频资源选择器 */}
      {showResourceSelector && (
        <AudioResourceSelector
          token={authToken}
          title={
            resourceSelectorType === "input"
              ? "选择 Mixture（输入混合音）"
              : "选择 Gold Standard（同组参考音轨）"
          }
          type={resourceSelectorType}
          bundleId={resourceSelectorType === 'gold' ? currentBundleId : null}
          onSelect={handleResourceSelect}
          onClose={() => {
            setShowResourceSelector(false);
            setResourceSelectorType(null);
          }}
        />
      )}
      {/* 排队位置浮窗 */}
      {queuePosition && (
        <QueuePositionToast
          position={queuePosition.position}
          queueLength={queuePosition.queue_length}
          isProcessing={queuePosition.is_processing}
          isCancelling={isCancelling}
          onCancel={async () => {
            if (!taskId || isCancelling) return;
            cancelSeparationRef.current.requested = true;
            setIsCancelling(true);
            // 立即调用取消 API
            try {
              await fetch(`${API_BASE}/api/tasks/${taskId}/cancel`, {
                method: "POST",
              });
            } catch (e) {
              console.error("取消任务失败:", e);
            }
            // 停止队列位置轮询
            if (queuePollIntervalRef.current) {
              clearInterval(queuePollIntervalRef.current);
              queuePollIntervalRef.current = null;
            }
            setQueuePosition(null);
            setIsProcessing(false);
            setIsCancelling(false);
            setProgressText("任务已取消");
          }}
          onClose={() => setQueuePosition(null)}
        />
      )}
    </div>
  );
}
