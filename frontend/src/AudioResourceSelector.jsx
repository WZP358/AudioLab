import React, { useState, useEffect, useCallback } from "react";
import { Music, Search, Filter, X, Check } from "lucide-react";
import { useToast } from "./Toast";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export default function AudioResourceSelector({ 
  token, 
  onSelect, 
  onClose,
  title = "选择音频资源"
}) {
  const { showError } = useToast();
  const [resources, setResources] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    category: "",
    search: "",
    page: 1,
    page_size: 20,
  });
  const [total, setTotal] = useState(0);
  const [selectedResource, setSelectedResource] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const formatErrorMessage = (err) => {
    if (!err) return "";
    if (typeof err === "string") return err;
    if (err.message) return err.message;
    try {
      return JSON.stringify(err, Object.getOwnPropertyNames(err));
    } catch {
      return String(err);
    }
  };

  const fetchResources = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.category) params.append("category", filters.category);
      if (filters.search) params.append("search", filters.search);
      params.append("page", filters.page);
      params.append("page_size", filters.page_size);

      const resp = await fetch(`${API_BASE}/api/audio/resources?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        let errBody;
        try {
          errBody = await resp.json();
        } catch (e) {
          errBody = await resp.text();
        }
        console.error("获取音频资源失败，返回体:", errBody);
        let message;
        if (errBody && errBody.detail) {
          if (Array.isArray(errBody.detail)) {
            message = errBody.detail.map((d) => d.msg || JSON.stringify(d)).join("; ");
          } else if (typeof errBody.detail === "string") {
            message = errBody.detail;
          } else {
            message = JSON.stringify(errBody.detail);
          }
        } else {
          message = JSON.stringify(errBody) || "获取音频资源失败";
        }
        throw new Error(message);
      }
      const data = await resp.json();
      setResources(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("获取音频资源失败:", err);
      showError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters.category, filters.search, filters.page, filters.page_size, token, showError]);

  const fetchCategories = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/audio/categories`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        let errBody;
        try {
          errBody = await resp.json();
        } catch (e) {
          errBody = await resp.text();
        }
        console.error("获取分类失败，返回体:", errBody);
        showError(formatErrorMessage(errBody && errBody.detail ? errBody.detail : errBody));
        return;
      }
      const data = await resp.json();
      setCategories(data.categories || []);
    } catch (err) {
      console.error("获取分类失败:", err);
      showError(formatErrorMessage(err));
    }
  }, [token, showError]);

  const handleSelect = async (resource) => {
    if (downloading) return;
    
    setDownloading(true);
    
    try {
      // 始终通过下载接口获取，让后端处理文件路径和重定向
      // 这样可以确保下载计数正确更新，并且后端可以处理各种路径格式
      const downloadUrl = `${API_BASE}/api/audio/resources/${resource.id}/download`;
      
      const resp = await fetch(downloadUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        redirect: 'follow', // 跟随重定向
      });
      
      if (!resp.ok) {
        // 尝试读取错误详情
        let errorDetail = `HTTP ${resp.status}`;
        try {
          const errorText = await resp.text();
          if (errorText) {
            try {
              const errorJson = JSON.parse(errorText);
              errorDetail = errorJson.detail || errorText;
            } catch {
              errorDetail = errorText;
            }
          }
        } catch (e) {
          // 忽略读取错误
        }
        throw new Error(`下载失败: ${errorDetail}`);
      }
      
      const blob = await resp.blob();
      
      // 检查 blob 是否为空或无效
      if (!blob || blob.size === 0) {
        throw new Error("下载的文件为空");
      }
      
      // 从响应头或资源信息中获取文件名
      const contentDisposition = resp.headers.get('content-disposition');
      let filename = resource.title || `audio_${resource.id}`;
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
        }
      }
      
      // 确保文件名有正确的扩展名
      if (resource.file_format && !filename.includes('.')) {
        filename = `${filename}.${resource.file_format}`;
      } else if (!filename.includes('.')) {
        filename = `${filename}.wav`;
      }
      
      // 从 blob 的 type 或资源信息中获取 MIME 类型
      let mimeType = blob.type;
      if (!mimeType || mimeType === 'application/octet-stream') {
        // 根据文件格式设置 MIME 类型
        const format = resource.file_format?.toLowerCase();
        const mimeTypes = {
          'mp3': 'audio/mpeg',
          'wav': 'audio/wav',
          'flac': 'audio/flac',
          'ogg': 'audio/ogg',
          'm4a': 'audio/mp4',
          'aac': 'audio/aac',
        };
        mimeType = mimeTypes[format] || 'audio/wav';
      }
      
      const file = new File([blob], filename, { type: mimeType });
      
      // 调用回调函数，传递文件对象和资源信息
      if (onSelect) {
        onSelect(file, resource);
      }
      
      // 关闭模态框
      if (onClose) {
        onClose();
      }
    } catch (err) {
      console.error("下载失败:", err);
      showError(formatErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const formatFileSize = (bytes) => {
    if (!bytes) return "未知";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "未知";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-xl border border-slate-700 w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <Music size={24} className="text-cyan-400" />
            <h3 className="text-xl font-bold text-white">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
          >
            <X size={20} />
          </button>
        </div>


        {/* 筛选器 */}
        <div className="p-6 border-b border-slate-700">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-2 flex items-center gap-2">
                <Filter size={14} />
                分类
              </label>
              <select
                value={filters.category}
                onChange={(e) => setFilters({ ...filters, category: e.target.value, page: 1 })}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              >
                <option value="">全部分类</option>
                {categories.map((cat) => (
                  <option key={cat.name} value={cat.name}>
                    {cat.name} ({cat.count})
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-2 flex items-center gap-2">
                <Search size={14} />
                搜索
              </label>
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
                placeholder="搜索标题或描述..."
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
            </div>
          </div>
        </div>

        {/* 资源列表 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-slate-400 py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
              <p className="mt-4">加载中...</p>
            </div>
          ) : resources.length === 0 ? (
            <div className="text-center text-slate-400 py-12">
              <Music size={48} className="mx-auto mb-4 opacity-50" />
              <p>暂无音频资源</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {resources.map((resource) => (
                  <div
                    key={resource.id}
                    onClick={() => setSelectedResource(resource.id)}
                    className={`bg-slate-800 rounded-xl p-6 border transition cursor-pointer group ${
                      selectedResource === resource.id
                        ? "border-cyan-500 bg-slate-800/80"
                        : "border-slate-700 hover:border-cyan-500/50"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className={`text-lg font-bold transition ${
                            selectedResource === resource.id
                              ? "text-cyan-400"
                              : "text-white group-hover:text-cyan-400"
                          }`}>
                            {resource.title}
                          </h3>
                          {selectedResource === resource.id && (
                            <Check size={18} className="text-cyan-400" />
                          )}
                        </div>
                        {resource.description && (
                          <p className="text-sm text-slate-400 line-clamp-2">{resource.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">格式</span>
                        <span className="text-slate-300 font-medium">{resource.file_format || "未知"}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">大小</span>
                        <span className="text-slate-300 font-medium">{formatFileSize(resource.file_size)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">时长</span>
                        <span className="text-slate-300 font-medium">{formatDuration(resource.duration)}</span>
                      </div>
                    </div>

                    {resource.category && (
                      <div className="mb-4">
                        <span className="px-2 py-1 bg-cyan-500/20 text-cyan-300 rounded text-xs">
                          {resource.category}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* 分页 */}
              {total > filters.page_size && (
                <div className="flex items-center justify-between px-6 py-4 bg-slate-800 rounded-lg border border-slate-700 mt-6">
                  <div className="text-sm text-slate-400">
                    共 {total} 条资源，第 {filters.page} / {Math.ceil(total / filters.page_size)} 页
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setFilters({ ...filters, page: Math.max(1, filters.page - 1) })}
                      disabled={filters.page === 1}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      上一页
                    </button>
                    <button
                      onClick={() =>
                        setFilters({ ...filters, page: Math.min(Math.ceil(total / filters.page_size), filters.page + 1) })
                      }
                      disabled={filters.page >= Math.ceil(total / filters.page_size)}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition"
          >
            取消
          </button>
          <button
            onClick={() => {
              if (selectedResource) {
                const resource = resources.find(r => r.id === selectedResource);
                if (resource) {
                  handleSelect(resource);
                }
              }
            }}
            disabled={!selectedResource || downloading}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {downloading ? (
              <>
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                下载中...
              </>
            ) : (
              <>
                <Check size={16} />
                确认选择
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
