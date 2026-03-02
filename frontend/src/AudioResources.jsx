import React, { useState, useEffect, useCallback, useRef } from "react";
import { Music, Search, Download, Filter, Play, Pause, Upload, X, ChevronDown, ChevronUp, Grid, List, Clock, TrendingUp, FileAudio } from "lucide-react";
import { useToast } from "./Toast";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export default function AudioResources({ token }) {
  const { showSuccess, showError } = useToast();
  const [resources, setResources] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [formats, setFormats] = useState([]);
  const pendingFetchAbortRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"
  
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
  const [playingId, setPlayingId] = useState(null);
  const [audioElements, setAudioElements] = useState({});
  
  // 上传表单状态：要求同时提供 Mixture + 4 个 Gold Standard Stem
  const [uploadForm, setUploadForm] = useState({
    mixtureFile: null,
    vocalsFile: null,
    drumsFile: null,
    bassFile: null,
    otherFile: null,
    title: "",
    description: "",
    category: "",
  });
  const [uploading, setUploading] = useState(false);

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

  const isAbortLike = (err) => {
    const name = err?.name || "";
    const msg = err?.message || "";
    return name === "AbortError" || /abort/i.test(msg);
  };

  const stopAndCleanupAudio = (audio) => {
    if (!audio) return;
    try {
      audio.__userStopped = true;
    } catch {}
    try {
      audio.pause();
    } catch {}
    try {
      if (typeof audio.src === "string" && audio.src.startsWith("blob:")) {
        window.URL.revokeObjectURL(audio.src);
      }
    } catch {}
    try {
      audio.removeAttribute("src");
      audio.load();
    } catch {
      try {
        audio.src = "";
      } catch {}
    }
    try {
      audio.currentTime = 0;
    } catch {}
  };

  // 搜索高亮函数
  const highlightText = (text, searchTerm) => {
    if (!searchTerm || !text) return text;
    const keywords = searchTerm.split(/\s+/).filter(k => k);
    let highlighted = text;
    keywords.forEach(keyword => {
      const regex = new RegExp(`(${keyword})`, "gi");
      highlighted = highlighted.replace(regex, '<mark class="bg-cyan-500/30 text-cyan-200">$1</mark>');
    });
    return highlighted;
  };

  // 防抖搜索
  const debouncedSearch = useCallback((searchValue) => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: searchValue, page: 1 }));
    }, 300);
  }, []);

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
  }, [filters, token, showError]);

  const fetchCategories = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/audio/categories`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) return;
      const data = await resp.json();
      setCategories(data.categories || []);
    } catch (err) {
      console.error("获取分类失败:", err);
    }
  }, [token]);

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

  const handleDownload = async (resourceId, filename) => {
    try {
      const url = `${API_BASE}/api/audio/resources/${resourceId}/download`;
      const resp = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error("下载失败");
      
      const blob = await resp.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename || "audio";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      
      fetchResources();
    } catch (err) {
      console.error("下载失败:", err);
      const errorMsg = "下载失败: " + (err && err.message ? err.message : String(err));
      showError(errorMsg);
    }
  };

  const handlePlay = (resourceId, filePath) => {
    if (pendingFetchAbortRef.current) {
      try {
        pendingFetchAbortRef.current.abort();
      } catch {}
      pendingFetchAbortRef.current = null;
    }

    Object.values(audioElements).forEach((audio) => stopAndCleanupAudio(audio));

    if (playingId === resourceId) {
      setPlayingId(null);
      setAudioElements({});
      return;
    }

    let audioUrl;
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
      audioUrl = filePath;
    } else if (filePath.startsWith("/")) {
      audioUrl = `${API_BASE}${filePath}`;
    } else {
      audioUrl = `${API_BASE}/api/audio/resources/${resourceId}/download`;
    }

    const audio = new Audio(audioUrl);
    audio.__userStopped = false;
    if (token) {
      const controller = new AbortController();
      pendingFetchAbortRef.current = controller;
      fetch(audioUrl, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        .then((resp) => resp.blob())
        .then((blob) => {
          const url = window.URL.createObjectURL(blob);
          audio.src = url;
          return audio.play();
        })
        .catch((err) => {
          if (audio.__userStopped || isAbortLike(err)) return;
          console.error("播放失败:", err);
          showError(formatErrorMessage(err));
          audio.src = audioUrl;
          return audio.play().catch((e) => {
            if (audio.__userStopped || isAbortLike(e)) return;
            console.error("播放失败(降级直播):", e);
            showError("音频播放失败，请尝试下载后播放");
          });
        });
    } else {
      audio.src = audioUrl;
      audio.play().catch((err) => {
        if (audio.__userStopped || isAbortLike(err)) return;
        console.error("播放失败:", err);
        showError("音频播放失败，请尝试下载后播放");
      });
    }
    
    audio.addEventListener("ended", () => {
      setPlayingId(null);
      setAudioElements({});
      if (audio.src.startsWith("blob:")) {
        window.URL.revokeObjectURL(audio.src);
      }
    });
    audio.addEventListener("error", (e) => {
      if (audio.__userStopped) return;
      if (!audio.src) return;
      console.error("音频播放错误:", e, audio?.error);
      showError("音频播放失败，请尝试下载后播放");
    });
    
    setPlayingId(resourceId);
    setAudioElements({ [resourceId]: audio });
  };

  const handleUpload = async () => {
    if (!token) {
      showError("请先登录");
      return;
    }

    const {
      mixtureFile,
      vocalsFile,
      drumsFile,
      bassFile,
      otherFile,
      title,
      description,
      category,
      tags,
    } = uploadForm;

    if (
      !mixtureFile ||
      !vocalsFile ||
      !drumsFile ||
      !bassFile ||
      !otherFile ||
      !title.trim()
    ) {
      showError("请同时选择 Mixture 以及 4 个 Gold Standard Stem，并填写标题");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("mixture", mixtureFile);
      formData.append("vocals", vocalsFile);
      formData.append("drums", drumsFile);
      formData.append("bass", bassFile);
      formData.append("other", otherFile);
      formData.append("title", title);
      if (description) formData.append("description", description);
      if (category) formData.append("category", category);

      const resp = await fetch(`${API_BASE}/api/audio/resources/upload-bundle`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!resp.ok) {
        let errData;
        try {
          errData = await resp.json();
        } catch (e) {
          errData = await resp.text();
        }
        const detail =
          errData && errData.detail
            ? errData.detail
            : typeof errData === "string"
            ? errData
            : "上传失败";
        throw new Error(detail);
      }

      showSuccess("上传成功！Mixture 及 4 个 Gold Standard Stem 已全部上传。");
      setShowUploadModal(false);
      setUploadForm({
        mixtureFile: null,
        vocalsFile: null,
        drumsFile: null,
        bassFile: null,
        otherFile: null,
        title: "",
        description: "",
        category: "",
        tags: "",
        is_public: true,
      });
      fetchResources();
      fetchCategories();
      fetchTags();
    } catch (err) {
      console.error("上传失败:", err);
      showError(formatErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  // 快捷筛选
  const applyQuickFilter = (type) => {
    const newFilters = { ...filters, page: 1 };
    switch (type) {
      case "hot":
        newFilters.sort_by = "download_count";
        newFilters.sort_order = "desc";
        break;
      case "latest":
        newFilters.sort_by = "created_at";
        newFilters.sort_order = "desc";
        break;
      case "long":
        newFilters.min_duration = 300; // 5分钟以上
        break;
      case "short":
        newFilters.max_duration = 180; // 3分钟以下
        break;
      default:
        break;
    }
    setFilters(newFilters);
  };

  const clearQuickFilter = () => {
    setFilters({
      ...filters,
      min_duration: "",
      max_duration: "",
      page: 1,
    });
  };

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  useEffect(() => {
    fetchCategories();
    fetchTags();
    fetchFormats();
  }, [fetchCategories, fetchTags, fetchFormats]);

  useEffect(() => {
    const currentElements = audioElements;
    return () => {
      Object.values(currentElements).forEach((audio) => {
        stopAndCleanupAudio(audio);
      });
    };
  }, [audioElements]);

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
    <div className="space-y-6 animate-in fade-in">
      {/* Header */}
      <div className="bg-slate-800 rounded-xl p-8 border border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Music size={32} className="text-cyan-400" />
            <h2 className="text-2xl font-bold text-white">音频资源库</h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
              className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition"
              title={viewMode === "grid" ? "列表视图" : "网格视图"}
            >
              {viewMode === "grid" ? <List size={20} /> : <Grid size={20} />}
            </button>
            {token && (
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition flex items-center gap-2"
              >
                <Upload size={18} />
                上传音频
              </button>
            )}
          </div>
        </div>
        <p className="text-slate-400">
          浏览和下载音频资源，支持高级搜索、筛选和排序功能
        </p>
      </div>


      {/* 快捷筛选标签 */}
      <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">快捷筛选：</span>
          <button
            onClick={() => applyQuickFilter("hot")}
            className="px-2.5 py-1 bg-slate-700/50 hover:bg-cyan-600 text-white rounded-md transition text-xs flex items-center gap-1.5 font-medium"
          >
            <TrendingUp size={12} />
            热门
          </button>
          <button
            onClick={() => applyQuickFilter("latest")}
            className="px-2.5 py-1 bg-slate-700/50 hover:bg-cyan-600 text-white rounded-md transition text-xs flex items-center gap-1.5 font-medium"
          >
            <Clock size={12} />
            最新
          </button>
          <button
            onClick={() => applyQuickFilter("long")}
            className="px-2.5 py-1 bg-slate-700/50 hover:bg-cyan-600 text-white rounded-md transition text-xs flex items-center gap-1.5 font-medium"
          >
            <FileAudio size={12} />
            长音频
          </button>
          <button
            onClick={() => applyQuickFilter("short")}
            className="px-2.5 py-1 bg-slate-700/50 hover:bg-cyan-600 text-white rounded-md transition text-xs flex items-center gap-1.5 font-medium"
          >
            <FileAudio size={12} />
            短音频
          </button>
          {(filters.min_duration || filters.max_duration) && (
            <button
              onClick={clearQuickFilter}
              className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-md transition text-xs font-medium"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* 筛选器 */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
        <div className="space-y-3">
          {/* 第一行：分类、上传者和搜索 */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* 分类 - 更紧凑的设计 */}
            <div className="flex-shrink-0 sm:w-40">
              <div className="relative">
                <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  value={filters.category}
                  onChange={(e) => setFilters({ ...filters, category: e.target.value, page: 1 })}
                  className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 appearance-none cursor-pointer"
                >
                  <option value="">全部分类</option>
                  {categories.map((cat) => (
                    <option key={cat.name} value={cat.name}>
                      {cat.name} ({cat.count})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* 上传者搜索 */}
            <div className="flex-shrink-0 sm:w-36">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={filters.uploader}
                  onChange={(e) => setFilters({ ...filters, uploader: e.target.value, page: 1 })}
                  placeholder="上传者"
                  className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                />
              </div>
            </div>
            {/* 搜索框 */}
            <div className="flex-1">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFilters(prev => ({ ...prev, search: value, page: 1 }));
                    debouncedSearch(value);
                  }}
                  placeholder="按标题搜索"
                  className="w-full pl-10 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                />
              </div>
            </div>
          </div>

          {/* 第二行：排序 - 更紧凑的内联设计 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-400 whitespace-nowrap">排序：</span>
            <div className="flex items-center gap-2">
              <select
                value={filters.sort_by}
                onChange={(e) => setFilters({ ...filters, sort_by: e.target.value, page: 1 })}
                className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 appearance-none cursor-pointer"
              >
                <option value="created_at">上传时间</option>
                <option value="download_count">下载次数</option>
                <option value="duration">时长</option>
                <option value="file_size">文件大小</option>
                <option value="title">标题</option>
              </select>
              <select
                value={filters.sort_order}
                onChange={(e) => setFilters({ ...filters, sort_order: e.target.value, page: 1 })}
                className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 appearance-none cursor-pointer"
              >
                <option value="desc">降序</option>
                <option value="asc">升序</option>
              </select>
            </div>
            {/* 高级筛选按钮 */}
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-slate-700/50 rounded-lg transition"
            >
              {showAdvancedFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              高级筛选
            </button>
          </div>

          {/* 高级筛选面板 */}
          {showAdvancedFilters && (
            <div className="pt-3 border-t border-slate-700/50">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">文件格式</label>
                  <select
                    value={filters.file_format}
                    onChange={(e) => setFilters({ ...filters, file_format: e.target.value, page: 1 })}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 appearance-none cursor-pointer"
                  >
                    <option value="">全部格式</option>
                    {formats.map((fmt) => (
                      <option key={fmt.name} value={fmt.name}>
                        {fmt.name.toUpperCase()} ({fmt.count})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">最小时长（秒）</label>
                  <input
                    type="number"
                    value={filters.min_duration}
                    onChange={(e) => setFilters({ ...filters, min_duration: e.target.value, page: 1 })}
                    placeholder="60"
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">最大时长（秒）</label>
                  <input
                    type="number"
                    value={filters.max_duration}
                    onChange={(e) => setFilters({ ...filters, max_duration: e.target.value, page: 1 })}
                    placeholder="300"
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">文件大小（MB）</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      value={filters.min_size ? filters.min_size / (1024 * 1024) : ""}
                      onChange={(e) => setFilters({ ...filters, min_size: e.target.value ? parseInt(e.target.value) * 1024 * 1024 : "", page: 1 })}
                      placeholder="最小"
                      className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                    />
                    <input
                      type="number"
                      value={filters.max_size ? filters.max_size / (1024 * 1024) : ""}
                      onChange={(e) => setFilters({ ...filters, max_size: e.target.value ? parseInt(e.target.value) * 1024 * 1024 : "", page: 1 })}
                      placeholder="最大"
                      className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                    />
                  </div>
                </div>
              </div>
              {/* 标签筛选 */}
              <div className="mt-3">
                <label className="block text-xs text-slate-400 mb-2">标签筛选</label>
                <div className="flex flex-wrap gap-1.5">
                  {tags.slice(0, 20).map((tag) => (
                    <button
                      key={tag.name}
                      onClick={() => {
                        const newTags = filters.tags.includes(tag.name)
                          ? filters.tags.filter(t => t !== tag.name)
                          : [...filters.tags, tag.name];
                        setFilters({ ...filters, tags: newTags, page: 1 });
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                        filters.tags.includes(tag.name)
                          ? "bg-cyan-600 text-white shadow-sm shadow-cyan-600/20"
                          : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                      }`}
                    >
                      {tag.name}
                      <span className="ml-1 text-slate-400">({tag.count})</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 资源列表 */}
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
          {viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {resources.map((resource) => (
                <div
                  key={resource.id}
                  className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-cyan-500/50 transition group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3
                        className="text-lg font-bold text-white mb-1 group-hover:text-cyan-400 transition"
                        dangerouslySetInnerHTML={{ __html: highlightText(resource.title, filters.search) }}
                      />
                      {resource.description && (
                        <p
                          className="text-sm text-slate-400 line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: highlightText(resource.description, filters.search) }}
                        />
                      )}
                      {resource.created_by && (
                        <p className="text-xs text-slate-500 mt-1">
                          上传者：
                          <button
                            onClick={() => setFilters({ ...filters, uploader: resource.created_by, page: 1 })}
                            className="text-cyan-400 hover:text-cyan-300 hover:underline transition ml-1"
                          >
                            {resource.created_by}
                          </button>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">格式</span>
                      <span className="text-slate-300 font-medium">{resource.file_format?.toUpperCase() || "未知"}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">大小</span>
                      <span className="text-slate-300 font-medium">{formatFileSize(resource.file_size)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">时长</span>
                      <span className="text-slate-300 font-medium">{formatDuration(resource.duration)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">下载次数</span>
                      <span className="text-slate-300 font-medium">{resource.download_count}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-4">
                    {resource.category && (
                      <span className="px-2 py-1 bg-cyan-500/20 text-cyan-300 rounded text-xs">
                        {resource.category}
                      </span>
                    )}
                    {resource.tags && resource.tags.split(",").slice(0, 3).map((tag, idx) => (
                      <span key={idx} className="px-2 py-1 bg-slate-700 text-slate-300 rounded text-xs">
                        {tag.trim()}
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePlay(resource.id, resource.file_path)}
                      className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition flex items-center justify-center gap-2"
                    >
                      {playingId === resource.id ? (
                        <>
                          <Pause size={16} />
                          暂停
                        </>
                      ) : (
                        <>
                          <Play size={16} />
                          播放
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleDownload(resource.id, resource.title)}
                      className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition flex items-center justify-center gap-2"
                    >
                      <Download size={16} />
                      下载
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {resources.map((resource) => (
                <div
                  key={resource.id}
                  className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-cyan-500/50 transition"
                >
                  <div className="flex items-center gap-6">
                    <button
                      onClick={() => handlePlay(resource.id, resource.file_path)}
                      className="p-3 rounded-lg bg-slate-700 hover:bg-cyan-600 text-white transition"
                    >
                      {playingId === resource.id ? <Pause size={20} /> : <Play size={20} />}
                    </button>
                    <div className="flex-1">
                      <h3
                        className="text-lg font-bold text-white mb-1"
                        dangerouslySetInnerHTML={{ __html: highlightText(resource.title, filters.search) }}
                      />
                      {resource.description && (
                        <p
                          className="text-sm text-slate-400 line-clamp-1"
                          dangerouslySetInnerHTML={{ __html: highlightText(resource.description, filters.search) }}
                        />
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                        <span>{resource.file_format?.toUpperCase() || "未知"}</span>
                        <span>{formatFileSize(resource.file_size)}</span>
                        <span>{formatDuration(resource.duration)}</span>
                        <span>下载 {resource.download_count} 次</span>
                        {resource.created_by && (
                          <span>
                            上传者：
                            <button
                              onClick={() => setFilters({ ...filters, uploader: resource.created_by, page: 1 })}
                              className="text-cyan-400 hover:text-cyan-300 hover:underline transition ml-1"
                            >
                              {resource.created_by}
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownload(resource.id, resource.title)}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition flex items-center gap-2"
                      >
                        <Download size={16} />
                        下载
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分页 */}
          {total > filters.page_size && (
            <div className="flex items-center justify-between px-6 py-4 bg-slate-800 rounded-lg border border-slate-700">
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

      {/* 上传模态框 */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">上传音频</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X size={24} />
              </button>
            </div>
            <div className="space-y-4">
              <div className="space-y-3">
                <label className="block text-sm text-slate-400">
                  输入 Mixture 与对应 4 个 Gold Standard Stem（必须一次性全部上传）
                </label>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Mixture（混合音） *</label>
                    <input
                      type="file"
                      accept=".mp3,.wav,.flac,.ogg,.m4a,.aac"
                      onChange={(e) =>
                        setUploadForm({ ...uploadForm, mixtureFile: e.target.files[0] || null })
                      }
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">
                        Gold Standard Vocals *
                      </label>
                      <input
                        type="file"
                        accept=".mp3,.wav,.flac,.ogg,.m4a,.aac"
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, vocalsFile: e.target.files[0] || null })
                        }
                        className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">
                        Gold Standard Drums *
                      </label>
                      <input
                        type="file"
                        accept=".mp3,.wav,.flac,.ogg,.m4a,.aac"
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, drumsFile: e.target.files[0] || null })
                        }
                        className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">
                        Gold Standard Bass *
                      </label>
                      <input
                        type="file"
                        accept=".mp3,.wav,.flac,.ogg,.m4a,.aac"
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, bassFile: e.target.files[0] || null })
                        }
                        className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">
                        Gold Standard Other *
                      </label>
                      <input
                        type="file"
                        accept=".mp3,.wav,.flac,.ogg,.m4a,.aac"
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, otherFile: e.target.files[0] || null })
                        }
                        className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">标题 *</label>
                <input
                  type="text"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                  placeholder="请输入音频标题"
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">描述</label>
                <textarea
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                  placeholder="请输入音频描述"
                  rows={3}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-2">分类</label>
                  <input
                    type="text"
                    value={uploadForm.category}
                    onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                    placeholder="例如：音乐、音效"
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>
                <div>
                  {/* 标签字段已废弃 */}
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleUpload}
                  disabled={
                    uploading ||
                    !uploadForm.mixtureFile ||
                    !uploadForm.vocalsFile ||
                    !uploadForm.drumsFile ||
                    !uploadForm.bassFile ||
                    !uploadForm.otherFile ||
                    !uploadForm.title.trim()
                  }
                  className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? "上传中..." : "上传"}
                </button>
                <button
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
