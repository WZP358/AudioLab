import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from "lucide-react";

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

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showInfo, showWarning, removeToast, showConfirm }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={confirmDialog.onCancel}
        />
      )}
    </ToastContext.Provider>
  );
};

const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
};

const ToastItem = ({ toast, onClose }) => {
  const { type, message } = toast;
  
  const getStyles = () => {
    switch (type) {
      case "success":
        return "bg-slate-800 border-emerald-500/50 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.2)]";
      case "error":
        return "bg-slate-800 border-red-500/50 text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.2)]";
      case "warning":
        return "bg-slate-800 border-yellow-500/50 text-yellow-300 shadow-[0_0_20px_rgba(234,179,8,0.2)]";
      case "info":
      default:
        return "bg-slate-800 border-cyan-500/50 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.2)]";
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
      className={`${getStyles()} min-w-[300px] max-w-[500px] rounded-lg shadow-xl border-2 pointer-events-auto flex items-start gap-3 p-4 backdrop-blur-sm animate-in slide-in-from-right-full duration-300`}
      role="alert"
    >
      {getIcon()}
      <div className="flex-1 text-sm font-medium">{message}</div>
      <button
        onClick={onClose}
        className="flex-shrink-0 hover:opacity-70 transition-opacity text-slate-400 hover:text-white"
        aria-label="关闭"
      >
        <X size={18} />
      </button>
    </div>
  );
};

const ConfirmDialog = ({ message, onConfirm, onCancel }) => {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-auto">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-slate-800 rounded-xl shadow-2xl border-2 border-slate-700 p-6 max-w-md w-full mx-4 animate-in zoom-in-95 duration-200">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-shrink-0 w-12 h-12 bg-yellow-500/10 rounded-full flex items-center justify-center border border-yellow-500/30">
            <AlertTriangle className="text-yellow-400" size={24} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-200 mb-2">操作确认</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors text-sm font-medium border border-slate-600"
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
