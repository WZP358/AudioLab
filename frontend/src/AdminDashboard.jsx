import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogOut, Shield, Sun, Moon, Laptop } from "lucide-react";
import AdminApproval from "./AdminApproval";
import { useTheme } from "./ThemeContext";

export default function AdminDashboard({ user, authToken, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [showApproval, setShowApproval] = useState(false);
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(64);

  // Derive admin tab from URL so links are shareable.
  // /admin/users | /admin/audio | /admin/scores | /admin/system[/...]
  const pathname = (location?.pathname || "").replace(/\/+$/, "") || "/";
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const adminTab =
    pathname.startsWith("/admin/audio")
      ? "audio"
      : pathname.startsWith("/admin/scores")
        ? "scores"
      : pathname.startsWith("/admin/system")
        ? "system"
        : "users";

  useEffect(() => {
    const updateHeights = () => {
      if (headerRef.current) {
        setHeaderHeight(headerRef.current.offsetHeight);
      }
    };
    
    updateHeights();
    window.addEventListener('resize', updateHeights);
    return () => window.removeEventListener('resize', updateHeights);
  }, []);

  useEffect(() => {
    // If admin lands on "/" (or any non-admin path while already authenticated as admin),
    // push them into a canonical shareable admin URL.
    if (!isAdminPath) {
      navigate("/admin/users", { replace: true });
      return;
    }
    if (pathname === "/admin") {
      navigate("/admin/users", { replace: true });
    }
  }, [isAdminPath, pathname, navigate]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 z-50"
      >
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield size={24} className="text-cyan-400" />
            <h1 className="text-xl font-bold text-slate-800 dark:text-white">AudioLab 管理后台</h1>
            <span className="ml-2 text-[10px] uppercase bg-red-500/20 text-red-300 px-2 py-0.5 rounded">
              管理员模式
            </span>
          </div>

          <div className="flex items-center gap-3">
            <AdminThemeSwitcher />
            <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-700 p-2 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-red-500 to-pink-600 flex items-center justify-center font-bold text-white text-[10px]">
                管理
              </div>
              <div className="text-sm">
                <p className="text-slate-700 dark:text-slate-300 font-medium">{user.username}</p>
                <p className="text-xs text-red-300">管理</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition"
              title="登出"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main 
        className="pb-12 px-4 max-w-7xl mx-auto"
        style={{ paddingTop: `${headerHeight + 16}px` }}
      >
          <div className="animate-in fade-in">
            <AdminApproval
              token={authToken}
              onClose={() => {}}
              embedded={true}
              defaultTab={adminTab}
            />
          </div>
      </main>

      {/* Admin Approval Modal */}
      {showApproval && (
        <AdminApproval
          token={authToken}
          onClose={() => setShowApproval(false)}
        />
      )}
    </div>
  );
}

function AdminThemeSwitcher() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const options = [
    { key: "system", label: "系统", icon: Laptop },
    { key: "light", label: "浅色", icon: Sun },
    { key: "dark", label: "深色", icon: Moon },
  ];

  const ActiveIcon = resolvedTheme === "dark" ? Moon : resolvedTheme === "light" ? Sun : Laptop;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs transition ${
          resolvedTheme === "dark"
            ? "border-slate-700/60 bg-slate-800/60 text-slate-200 hover:border-cyan-500/70 hover:text-white hover:bg-slate-800"
            : "border-slate-200 bg-white text-slate-700 hover:border-cyan-400/60 hover:text-slate-900 hover:bg-slate-100"
        }`}
        title="切换外观主题"
      >
        <ActiveIcon size={14} className="text-cyan-400" />
        <span>{theme === "system" ? "系统" : theme === "light" ? "浅色" : "深色"}</span>
      </button>
      {open && (
        <div
          className={`absolute right-0 mt-2 w-36 rounded-lg border shadow-lg overflow-hidden ${
            resolvedTheme === "dark" ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
          }`}
        >
          {options.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTheme(key);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                resolvedTheme === "dark"
                  ? "hover:bg-slate-800 text-slate-200"
                  : "hover:bg-slate-100 text-slate-700"
              }`}
            >
              <Icon size={14} className="text-cyan-400" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
