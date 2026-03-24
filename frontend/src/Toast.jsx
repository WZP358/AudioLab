import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from "lucide-react";
import { useTheme } from "./ThemeContext";

const ToastContext = createContext(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const showToast = useCallback((type, message, duration = 5000) => {
    const id = Date.now() + Math.random();
    const toast = { id, type, message, duration };
    
    setToasts((prev) => [...prev, toast]);
    
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
    
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showSuccess = useCallback((message, duration) => {
    return showToast("success", message, duration);
  }, [showToast]);

  const showError = useCallback((message, duration) => {
    return showToast("error", message, duration);
  }, [showToast]);

  const showInfo = useCallback((message, duration) => {
    return showToast("info", message, duration);
  }, [showToast]);

  const showWarning = useCallback((message, duration) => {
    return showToast("warning", message, duration);
  }, [showToast]);

  const [confirmDialog, setConfirmDialog] = useState(null);

  const showConfirm = useCallback((message, onConfirm, onCancel) => {
    setConfirmDialog({
      message,
      onConfirm: () => {
        setConfirmDialog(null);
        if (onConfirm) onConfirm();
      },
      onCancel: () => {
        setConfirmDialog(null);
        if (onCancel) onCancel();
      },
    });
  }, []);

  const [alertDialog, setAlertDialog] = useState(null);

  const showAlert = useCallback((message, onOk) => {
    setAlertDialog({
      message,
      onOk: () => {
        setAlertDialog(null);
        if (onOk) onOk();
      },
    });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showInfo, showWarning, removeToast, showConfirm, showAlert }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} isDark={isDark} />
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={confirmDialog.onCancel}
          isDark={isDark}
        />
      )}
      {alertDialog && (
        <AlertDialog
          message={alertDialog.message}
          onOk={alertDialog.onOk}
          isDark={isDark}
        />
      )}
    </ToastContext.Provider>
  );
};

const ToastContainer = ({ toasts, removeToast, isDark }) => {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} isDark={isDark} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
};

const ToastItem = ({ toast, onClose, isDark }) => {
  const { type, message } = toast;
  
  const getStyles = () => {
    const base = isDark
      ? "border-2"
      : "border bg-white";
    switch (type) {
      case "success":
        return isDark
          ? `${base} bg-slate-800 border-emerald-500/50 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.2)]`
          : `${base} border-emerald-200 text-emerald-700 shadow-[0_0_20px_rgba(16,185,129,0.12)]`;
      case "error":
        return isDark
          ? `${base} bg-slate-800 border-red-500/50 text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.2)]`
          : `${base} border-red-200 text-red-700 shadow-[0_0_20px_rgba(239,68,68,0.12)]`;
      case "warning":
        return isDark
          ? `${base} bg-slate-800 border-yellow-500/50 text-yellow-300 shadow-[0_0_20px_rgba(234,179,8,0.2)]`
          : `${base} border-amber-200 text-amber-700 shadow-[0_0_20px_rgba(245,158,11,0.12)]`;
      case "info":
      default:
        return isDark
          ? `${base} bg-slate-800 border-cyan-500/50 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.2)]`
          : `${base} border-cyan-200 text-cyan-700 shadow-[0_0_20px_rgba(6,182,212,0.12)]`;
    }
  };

  const getIcon = () => {
    switch (type) {
      case "success":
        return <CheckCircle size={20} className="flex-shrink-0 text-emerald-400" />;
      case "error":
        return <AlertCircle size={20} className="flex-shrink-0 text-red-400" />;
      case "warning":
        return <AlertCircle size={20} className="flex-shrink-0 text-yellow-400" />;
      case "info":
      default:
        return <Info size={20} className="flex-shrink-0 text-cyan-400" />;
    }
  };

  return (
    <div
      className={`${getStyles()} min-w-[300px] max-w-[500px] rounded-lg shadow-xl pointer-events-auto flex items-start gap-3 p-4 backdrop-blur-sm animate-in slide-in-from-right-full duration-300`}
      role="alert"
    >
      {getIcon()}
      <div className="flex-1 text-sm font-medium">{message}</div>
      <button
        onClick={onClose}
        className={`flex-shrink-0 hover:opacity-70 transition-opacity ${
          isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-800"
        }`}
        aria-label="关闭"
      >
        <X size={18} />
      </button>
    </div>
  );
};

const ConfirmDialog = ({ message, onConfirm, onCancel, isDark }) => {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-auto">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        className={`relative rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 animate-in zoom-in-95 duration-200 ${
          isDark ? "bg-slate-800 border-2 border-slate-700" : "bg-white border border-slate-200"
        }`}
      >
        <div className="flex items-start gap-4 mb-6">
          <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
            isDark ? "bg-yellow-500/10 border border-yellow-500/30" : "bg-amber-50 border border-amber-200"
          }`}>
            <AlertTriangle className="text-yellow-400" size={24} />
          </div>
          <div className="flex-1">
            <h3 className={`text-lg font-semibold mb-2 ${isDark ? "text-slate-200" : "text-slate-800"}`}>操作确认</h3>
            <p className={`text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
              isDark
                ? "bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600"
                : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300"
            }`}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors text-sm font-medium shadow-lg shadow-red-500/20"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
};

const AlertDialog = ({ message, onOk, isDark }) => {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-auto">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onOk} />
      <div
        className={`relative rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 animate-in zoom-in-95 duration-200 ${
          isDark ? "bg-slate-800 border-2 border-slate-700" : "bg-white border border-slate-200"
        }`}
      >
        <div className="flex items-start gap-4 mb-6">
          <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
            isDark ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-cyan-50 border border-cyan-200"
          }`}>
            <Info className={isDark ? "text-cyan-300" : "text-cyan-600"} size={24} />
          </div>
          <div className="flex-1">
            <h3 className={`text-lg font-semibold mb-2 ${isDark ? "text-slate-200" : "text-slate-800"}`}>提示</h3>
            <p className={`text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onOk}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors text-sm font-medium shadow-lg shadow-cyan-600/20"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
};
