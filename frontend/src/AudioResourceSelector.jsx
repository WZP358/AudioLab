import React, { useState, useEffect, useCallback } from "react";
import { Music, Search, Filter, X, Check, Grid, List, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "./Toast";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export default function AudioResourceSelector({
  token,
  onSelect,
  onClose,
  title = "选择音频资源",
  type = null, // 'input' | 'gold' | null
  bundleId = null, // 当前联动的 bundle（例如已选择的 Mixture 所在 bundle）
}) {
  const { showError } = useToast();
  const [resources, setResources] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [formats, setFormats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filters, setFilters] = useState({
    category: "",
    search: "",
    uploader: "",
    file_format: "",
    min_duration: "",
    max_duration: "",
    min_size: "",
    max_size: "",
    sort_by: "created_at",
    sort_order: "desc",
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
      if (filters.uploader) params.append("uploader", filters.uploader);
      if (filters.file_format) params.append("file_format", filters.file_format);
      if (filters.min_duration) params.append("min_duration", filters.min_duration);
      if (filters.max_duration) params.append("max_duration", filters.max_duration);
      if (filters.min_size) params.append("min_size", filters.min_size);
      if (filters.max_size) params.append("max_size", filters.max_size);
      params.append("sort_by", filters.sort_by);
      params.append("sort_order", filters.sort_order);
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
  }, [
    filters.category,
    filters.search,
    filters.uploader,
    filters.file_format,
    filters.min_duration,
    filters.max_duration,
    filters.min_size,
    filters.max_size,
    filters.sort_by,
    filters.sort_order,
    filters.page,
    filters.page_size,
    token,
    showError,
  ]);

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

  const fetchTags = useCallback(async () => {
    // 后端已移除标签字段，这里保留空实现以兼容现有调用
    setTags([]);
  }, []);

  const fetchFormats = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/audio/formats`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) return;
      const data = await resp.json();
      setFormats(data.formats || []);
    } catch (err) {
      console.error("获取格式失败:", err);
    }
  }, [token]);

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
        throw new Error(`下载失败：${errorDetail}`);
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
    fetchTags();
    fetchFormats();
  }, [fetchCategories, fetchTags, fetchFormats]);

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

  // 取消基于 tags 的 bundle 分组逻辑，直接按资源平铺展示
  const groupedList = resources.length
    ? [
        {
          bundleId: null,
          items: resources,
        },
      ]
    : [];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-xl border border-slate-700 w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <Music size={24} className="text-cyan-400" />
            <h3 className="text-xl font-bold text-white">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 transition"
              title={viewMode === "grid" ? "列表视图" : "卡片视图"}
            >
              {viewMode === "grid" ? <List size={18} /> : <Grid size={18} />}
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
            >
              <X size={20} />
            </button>
          </div>
        </div>


        {/* 筛选器 */}
        <div className="p-6 border-b border-slate-700 space-y-3">
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
            <div>
              <label className="block text-xs text-slate-400 mb-2 flex items-center gap-2">
                <Search size={14} />
                标题 / 描述
              </label>
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
                placeholder="按标题、描述关键词搜索..."
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-2 flex items-center gap-2">
                <Search size={14} />
                上传者
              </label>
              <input
                type="text"
                value={filters.uploader}
                onChange={(e) => setFilters({ ...filters, uploader: e.target.value, page: 1 })}
                placeholder="按上传者用户名搜索..."
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span>可以同时按分类、标题和上传者组合筛选。</span>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="flex items-center gap-1.5 text-[11px] text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded hover:bg-slate-800 transition"
            >
              {showAdvancedFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              高级筛选
            </button>
          </div>

          {showAdvancedFilters && (
            <div className="pt-3 border-t border-slate-700/60 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">文件格式</label>
                  <select
                    value={filters.file_format}
                    onChange={(e) => setFilters({ ...filters, file_format: e.target.value, page: 1 })}
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  >
                    <option value="">全部格式</option>
                    {formats.map((fmt) => (
                      <option key={fmt.name} value={fmt.name}>
                        {fmt.name.toUpperCase()} ({fmt.count})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">最小时长（秒）</label>
                    <input
                      type="number"
                      value={filters.min_duration}
                      onChange={(e) => setFilters({ ...filters, min_duration: e.target.value, page: 1 })}
                      placeholder="例如 60"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">最大时长（秒）</label>
                    <input
                      type="number"
                      value={filters.max_duration}
                      onChange={(e) => setFilters({ ...filters, max_duration: e.target.value, page: 1 })}
                      placeholder="例如 300"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">最小大小（MB）</label>
                    <input
                      type="number"
                      value={filters.min_size ? filters.min_size / (1024 * 1024) : ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          min_size: e.target.value ? parseInt(e.target.value, 10) * 1024 * 1024 : "",
                          page: 1,
                        })
                      }
                      placeholder="例如 1"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">最大大小（MB）</label>
                    <input
                      type="number"
                      value={filters.max_size ? filters.max_size / (1024 * 1024) : ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          max_size: e.target.value ? parseInt(e.target.value, 10) * 1024 * 1024 : "",
                          page: 1,
                        })
                      }
                      placeholder="例如 20"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>
                </div>
              </div>

              {/* 标签筛选 & 排序 */}
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1.5">标签快速筛选</label>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.slice(0, 16).map((tag) => (
                      <button
                        key={tag.name}
                        type="button"
                        onClick={() => {
                          const exists = filters.tags.includes(tag.name);
                          const nextTags = exists
                            ? filters.tags.filter((t) => t !== tag.name)
                            : [...filters.tags, tag.name];
                          setFilters({ ...filters, tags: nextTags, page: 1 });
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] transition ${
                          filters.tags.includes(tag.name)
                            ? "bg-cyan-600 text-white shadow-sm shadow-cyan-600/30"
                            : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        {tag.name}
                        <span className="ml-1 text-slate-500">({tag.count})</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">排序：</span>
                  <select
                    value={filters.sort_by}
                    onChange={(e) => setFilters({ ...filters, sort_by: e.target.value, page: 1 })}
                    className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-[11px] focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  >
                    <option value="created_at">上传时间</option>
                    <option value="duration">时长</option>
                    <option value="file_size">文件大小</option>
                    <option value="title">标题</option>
                  </select>
                  <select
                    value={filters.sort_order}
                    onChange={(e) => setFilters({ ...filters, sort_order: e.target.value, page: 1 })}
                    className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-[11px] focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  >
                    <option value="desc">降序</option>
                    <option value="asc">升序</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 资源列表 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-slate-400 py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
              <p className="mt-4">加载中...</p>
            </div>
          ) : groupedList.length === 0 ? (
            <div className="text-center text-slate-400 py-12">
              <Music size={48} className="mx-auto mb-4 opacity-50" />
              <p>暂无音频资源</p>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {groupedList.map((group) => {
                  const bundleResources = group.items;
                  const bundleIdLabel = group.bundleId;
                  // 尝试从标题中提取基础标题（去掉 [Mixture]/[Gold ...] 后的部分）
                  const firstTitle = bundleResources[0]?.title || "";
                  const baseTitle = firstTitle.split(" [")[0] || firstTitle;

                  return (
                    <div
                      key={bundleIdLabel || `single-${bundleResources[0].id}`}
                      className="bg-slate-800 rounded-xl border border-slate-700 p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-white">
                              {bundleIdLabel ? `成组音频：${baseTitle}` : baseTitle || "未命名音频"}
                            </h3>
                            {bundleIdLabel && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                                bundle: {bundleIdLabel.slice(0, 8)}…
                              </span>
                            )}
                          </div>
                          {type === "gold" && bundleId && (
                            <p className="text-[11px] text-slate-400 mt-1">
                              已根据当前选择的 Mixture 自动筛选到同一组的 Gold Standard 音轨。
                            </p>
                          )}
                        </div>
                      </div>

                      {viewMode === "grid" ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {bundleResources.map((resource) => {
                            const isSelected = selectedResource === resource.id;
                            let roleLabel = "";
                            if (resource._role === "mixture") roleLabel = "Mixture";
                            else if (resource._role === "gold_vocals") roleLabel = "Gold Vocals";
                            else if (resource._role === "gold_drums") roleLabel = "Gold Drums";
                            else if (resource._role === "gold_bass") roleLabel = "Gold Bass";
                            else if (resource._role === "gold_other") roleLabel = "Gold Other";

                            return (
                              <div
                                key={resource.id}
                                onClick={() => setSelectedResource(resource.id)}
                                className={`rounded-lg p-4 border transition cursor-pointer group ${
                                  isSelected
                                    ? "border-cyan-500 bg-slate-800/80"
                                    : "border-slate-700 hover:border-cyan-500/50 bg-slate-900/40"
                                }`}
                              >
                                <div className="flex items-start justify-between mb-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <h4
                                        className={`text-sm font-semibold truncate transition ${
                                          isSelected
                                            ? "text-cyan-400"
                                            : "text-white group-hover:text-cyan-400"
                                        }`}
                                      >
                                        {resource.title}
                                      </h4>
                                      {isSelected && <Check size={16} className="text-cyan-400" />}
                                    </div>
                                    {resource.description && (
                                      <p className="text-xs text-slate-400 line-clamp-2">
                                        {resource.description}
                                      </p>
                                    )}
                                  </div>
                                  {roleLabel && (
                                    <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] bg-slate-700 text-slate-200">
                                      {roleLabel}
                                    </span>
                                  )}
                                </div>

                                <div className="space-y-1.5 mb-2">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-slate-500">格式</span>
                                    <span className="text-slate-200 font-medium">
                                      {resource.file_format || "未知"}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-slate-500">大小</span>
                                    <span className="text-slate-200 font-medium">
                                      {formatFileSize(resource.file_size)}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-slate-500">时长</span>
                                    <span className="text-slate-200 font-medium">
                                      {formatDuration(resource.duration)}
                                    </span>
                                  </div>
                                </div>

                                {resource.category && (
                                  <div className="mt-1">
                                    <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 rounded text-[10px]">
                                      {resource.category}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {bundleResources.map((resource) => {
                            const isSelected = selectedResource === resource.id;
                            let roleLabel = "";
                            if (resource._role === "mixture") roleLabel = "Mixture";
                            else if (resource._role === "gold_vocals") roleLabel = "Gold Vocals";
                            else if (resource._role === "gold_drums") roleLabel = "Gold Drums";
                            else if (resource._role === "gold_bass") roleLabel = "Gold Bass";
                            else if (resource._role === "gold_other") roleLabel = "Gold Other";

                            return (
                              <div
                                key={resource.id}
                                onClick={() => setSelectedResource(resource.id)}
                                className={`rounded-lg p-4 border transition cursor-pointer flex items-center gap-4 ${
                                  isSelected
                                    ? "border-cyan-500 bg-slate-800/80"
                                    : "border-slate-700 hover:border-cyan-500/50 bg-slate-900/40"
                                }`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <h4
                                      className={`text-sm font-semibold truncate transition ${
                                        isSelected ? "text-cyan-400" : "text-white"
                                      }`}
                                    >
                                      {resource.title}
                                    </h4>
                                    {isSelected && <Check size={16} className="text-cyan-400" />}
                                    {roleLabel && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-700 text-slate-200">
                                        {roleLabel}
                                      </span>
                                    )}
                                  </div>
                                  {resource.description && (
                                    <p className="text-xs text-slate-400 line-clamp-1">
                                      {resource.description}
                                    </p>
                                  )}
                                  <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-slate-400">
                                    <span>{resource.file_format || "未知"}</span>
                                    <span>{formatFileSize(resource.file_size)}</span>
                                    <span>{formatDuration(resource.duration)}</span>
                                    {resource.category && (
                                      <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 rounded text-[10px]">
                                        {resource.category}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 分页 */}
              {total > filters.page_size && (
                <div className="flex items-center justify-between px-6 py-4 bg-slate-800 rounded-lg border border-slate-700 mt-6">
                  <div className="text-sm text-slate-400">
                    共 {total} 条资源，第 {filters.page} / {Math.ceil(total / filters.page_size)} 页
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setFilters({ ...filters, page: Math.max(1, filters.page - 1) })
                      }
                      disabled={filters.page === 1}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      上一页
                    </button>
                    <button
                      onClick={() =>
                        setFilters({
                          ...filters,
                          page: Math.min(
                            Math.ceil(total / filters.page_size),
                            filters.page + 1
                          ),
                        })
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
