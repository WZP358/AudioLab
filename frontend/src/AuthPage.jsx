import React, { useState, useRef, useEffect } from "react";
import { Mail, Lock, User, Upload, Loader } from "lucide-react";
import { useToast } from "./Toast";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";
const SEND_CODE_COOLDOWN_S = 30;

export default function AuthPage({ onLoginSuccess }) {
  const { showSuccess, showError } = useToast();
  const [mode, setMode] = useState("login"); // 'login' or 'register'
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    username: "",
    code: "",
    // 仅支持专家 / 管理员两种身份，默认专家
    role: "expert",
    avatar_url: "",
  });
  const [avatar, setAvatar] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeAttempts, setCodeAttempts] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState({}); // 按邮箱存储冷却时间
  const cooldownTimersRef = useRef({}); // 存储每个邮箱的定时器
  const fileInputRef = useRef(null);

  // 组件卸载时清理所有定时器
  useEffect(() => {
    return () => {
      Object.values(cooldownTimersRef.current).forEach(timer => {
        if (timer) clearInterval(timer);
      });
    };
  }, []);

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatar(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadAvatar = async () => {
    if (!avatar) return null;
    try {
      const formData = new FormData();
      formData.append("file", avatar);
      const resp = await fetch(`${API_BASE}/api/auth/upload_avatar`, {
        method: "POST",
        body: formData,
      });
      if (!resp.ok) throw new Error("头像上传失败");
      const data = await resp.json();
      return data.avatar_url;
    } catch (err) {
      console.error("头像上传错误:", err);
      return null;
    }
  };

  const handleSendCode = async () => {
    if (!formData.email) {
      showError("请填写邮箱地址。");
      return;
    }
    const email = formData.email;
    const currentCooldown = cooldownLeft[email] || 0;
    if (currentCooldown > 0) {
      showError(`操作频繁，请在 ${currentCooldown}s 后重试。`);
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/auth/send_code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      });
      if (!resp.ok) {
        let errorMsg = "发送失败";
        try {
          const errorData = await resp.json();
          errorMsg = errorData.detail || errorData.message || JSON.stringify(errorData);
        } catch {
          const errorText = await resp.text();
          errorMsg = errorText || "发送失败";
        }
        throw new Error(errorMsg);
      }
      setCodeSent(true);
      showSuccess("验证码已发送，请查收。");
      // 按邮箱设置冷却时间，避免频繁点导致 429
      setCooldownLeft((prev) => ({ ...prev, [email]: SEND_CODE_COOLDOWN_S }));
      // 清除该邮箱之前的定时器（如果存在）
      if (cooldownTimersRef.current[email]) {
        clearInterval(cooldownTimersRef.current[email]);
      }
      // 为该邮箱创建新的定时器
      const timer = setInterval(() => {
        setCooldownLeft((prev) => {
          const current = prev[email] || 0;
          if (current <= 1) {
            clearInterval(timer);
            delete cooldownTimersRef.current[email];
            const newState = { ...prev };
            delete newState[email];
            return newState;
          }
          return { ...prev, [email]: current - 1 };
        });
      }, 1000);
      cooldownTimersRef.current[email] = timer;
    } catch (err) {
      const msg = `${err?.message || err}`;
      // 后端会返回 429 Too Many Requests 的 detail；这里做个友好提示
      if (msg.includes("429") || msg.toLowerCase().includes("too many") || msg.toLowerCase().includes("please wait")) {
        showError("请求过于频繁，请稍后重试。");
      } else if (msg.toLowerCase().includes("failed to send verification email")) {
        showError("验证码发送失败：邮件服务未就绪。请稍后重试或联系管理员。");
      } else {
        showError(`发送失败：${msg}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!codeSent) {
      showError("请先获取验证码。");
      return;
    }
    if (!formData.username || !formData.password || !formData.code) {
      showError("请补全必填信息。");
      return;
    }

    setLoading(true);
    try {
      // 先上传头像（如果有）
      let avatarUrl = formData.avatar_url;
      if (avatar) {
        avatarUrl = await uploadAvatar();
      }

      const resp = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          avatar_url: avatarUrl,
        }),
      });

      if (!resp.ok) {
        let errorMsg = "注册失败";
        try {
          const errorData = await resp.json();
          errorMsg = errorData.detail || errorData.message || JSON.stringify(errorData);
        } catch {
          const errorText = await resp.text();
          errorMsg = errorText || "注册失败";
        }
        throw new Error(errorMsg);
      }

      const data = await resp.json();
      
      if (data.message === "application_submitted") {
        showSuccess("申请已提交，等待管理员审核。");
        setTimeout(() => {
          setMode("login");
          setFormData({ email: "", password: "", username: "", code: "", role: "expert", avatar_url: "" });
          setCodeSent(false);
        }, 2000);
      } else {
        showSuccess("注册成功，即将跳转至登录。");
        setTimeout(() => {
          setMode("login");
          setFormData({ ...formData, password: "", code: "" });
        }, 1500);
      }
    } catch (err) {
      const errorMsg = err.message || "注册失败";
      if (errorMsg.includes("Too many attempts")) {
        setCodeAttempts(prev => prev + 1);
        if (codeAttempts >= 2) {
          setCodeSent(false);
          showError("验证失败次数过多，请重新获取验证码。");
        } else {
          showError("验证码错误，请重试。");
        }
      } else if (errorMsg.includes("用户名已被使用")) {
        showError("用户名已被占用，请更换。");
      } else if (errorMsg.includes("邮箱已注册") || errorMsg.includes("邮箱已有")) {
        showError(errorMsg);
      } else {
        showError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!formData.email || !formData.password) {
      showError("请输入邮箱与密码。");
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });

      if (!resp.ok) {
        let errorMsg = "登录失败";
        try {
          const errorData = await resp.json();
          errorMsg = errorData.detail || errorData.message || JSON.stringify(errorData);
        } catch {
          const errorText = await resp.text();
          errorMsg = errorText || "登录失败";
        }
        throw new Error(errorMsg);
      }

      const data = await resp.json();
      localStorage.setItem("auth_token", data.access_token);
      
      // 获取用户信息
      const userResp = await fetch(`${API_BASE}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
        },
      });
      
      if (userResp.ok) {
        const user = await userResp.json();
        showSuccess("登录成功。");
        setTimeout(() => onLoginSuccess(user, data.access_token), 500);
      } else {
        // 如果获取用户信息失败，清除token并提示错误
        localStorage.removeItem("auth_token");
        let errorMsg = "登录成功但获取用户信息失败";
        try {
          const errorData = await userResp.json();
          errorMsg = errorData.detail || errorData.message || errorMsg;
        } catch {
          const errorText = await userResp.text();
          errorMsg = errorText || errorMsg;
        }
        showError(errorMsg);
      }
    } catch (err) {
      const errorMsg = err.message || "登录失败";
      if (errorMsg.includes("pending admin approval")) {
        showError("账号待管理员审核。");
      } else if (errorMsg.includes("rejected or disabled")) {
        showError("账号已禁用，请重新提交申请。");
      } else {
        showError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 animate-in fade-in slide-in-from-bottom-4">
        {/* Logo & Title */}
        <div className="text-center">
          <div className="w-20 h-20 bg-cyan-500/10 rounded-full flex items-center justify-center border border-cyan-500/30 shadow-[0_0_30px_rgba(6,182,212,0.3)] mx-auto mb-4">
            <User size={40} className="text-cyan-400" />
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">
            Audio<span className="text-cyan-400">Lab</span>
          </h1>
          <p className="text-slate-400 mt-2">音乐源分离评估平台</p>
        </div>


        {/* Mode Toggle */}
        <div className="flex gap-2 bg-slate-800/50 p-1 rounded-lg border border-slate-700">
          <button
            onClick={() => setMode("login")}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
              mode === "login"
                ? "bg-cyan-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            登录
          </button>
          <button
            onClick={() => {
              setMode("register");
              setCodeSent(false);
              setCodeAttempts(0);
            }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
              mode === "register"
                ? "bg-cyan-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            注册
          </button>
        </div>

        {/* Form */}
        <form onSubmit={mode === "login" ? handleLogin : handleRegister} className="space-y-4">
          {mode === "register" && (
            <>
              {/* Username */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  用户名 *
                </label>
                <div className="relative">
                  <User size={18} className="absolute left-3 top-3 text-slate-500" />
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-white"
                    placeholder="请输入用户名"
                    required
                  />
                </div>
              </div>

              {/* Role Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  用户类型 *
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-white"
                >
                  <option value="expert">专家（需管理员审批）</option>
                  <option value="admin">管理员（需管理员审批）</option>
                </select>
                <p className="text-xs text-yellow-400 mt-1">
                  注意：所有账号需要等待管理员审批通过后才能登录
                </p>
              </div>

              {/* Avatar Upload */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  头像（可选）
                </label>
                <div className="flex items-center gap-4">
                  {avatarPreview && (
                    <img
                      src={avatarPreview}
                      alt="Avatar Preview"
                      className="w-16 h-16 rounded-full object-cover border-2 border-cyan-500"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition text-sm"
                  >
                    <Upload size={16} />
                    选择头像
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </div>
              </div>
            </>
          )}

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              邮箱 *
            </label>
            <div className="relative">
              <Mail size={18} className="absolute left-3 top-3 text-slate-500" />
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-white"
                placeholder="请输入邮箱"
                required
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              密码 *
            </label>
            <div className="relative">
              <Lock size={18} className="absolute left-3 top-3 text-slate-500" />
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-white"
                placeholder="请输入密码"
                required
              />
            </div>
          </div>

          {/* Verification Code (Register only) */}
          {mode === "register" && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                验证码 *
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-white"
                    placeholder="请输入6位验证码"
                    maxLength={6}
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={loading || !formData.email || (cooldownLeft[formData.email] || 0) > 0}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition text-sm font-medium whitespace-nowrap"
                >
                  {(cooldownLeft[formData.email] || 0) > 0 ? `${cooldownLeft[formData.email]}s` : (codeSent ? "重新发送" : "获取验证码")}
                </button>
              </div>
              {codeAttempts > 0 && (
                <p className="text-xs text-orange-400 mt-1">
                  验证失败 {codeAttempts} 次，失败 3 次后需重新获取验证码
                </p>
              )}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-slate-700 disabled:to-slate-700 text-white font-bold rounded-lg shadow-lg transition flex items-center justify-center gap-2"
          >
            {loading && <Loader size={18} className="animate-spin" />}
            {mode === "login" ? "登录" : "注册"}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500">
          {mode === "login" ? "还没有账号？" : "已有账号？"}
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setCodeSent(false);
              setCodeAttempts(0);
            }}
            className="text-cyan-400 hover:text-cyan-300 ml-1"
          >
            {mode === "login" ? "立即注册" : "立即登录"}
          </button>
        </p>
      </div>
    </div>
  );
}
