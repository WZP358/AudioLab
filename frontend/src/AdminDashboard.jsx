import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogOut, Shield } from "lucide-react";
import AdminApproval from "./AdminApproval";

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
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header ref={headerRef} className="fixed top-0 left-0 right-0 bg-slate-800 border-b border-slate-700 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield size={24} className="text-cyan-400" />
            <h1 className="text-xl font-bold text-white">AudioLab 管理后台</h1>
            <span className="ml-2 text-[10px] uppercase bg-red-500/20 text-red-300 px-2 py-0.5 rounded">
              管理员模式
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 bg-slate-700 p-2 rounded-lg">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.username}
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-red-500 to-pink-600 flex items-center justify-center font-bold text-white text-xs">
                  {user.username.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="text-sm">
                <p className="text-slate-300 font-medium">{user.username}</p>
                <p className="text-xs text-red-300">管理员</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition"
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
