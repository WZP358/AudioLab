import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Users,
  Music,
  Upload,
  Edit,
  Trash2,
  Search,
  X,
  CheckCircle,
  XCircle,
  Plus,
  Save,
  Settings,
  ChevronDown,
  ChevronUp,
  Clock,
  TrendingUp,
  FileAudio,
  Filter,
  Award,
  BarChart3,
  MessageCircle,
  Grid,
  List,
  Activity,
} from "lucide-react";
import SystemManagement from "./SystemManagement";
import { useToast } from "./Toast";

const API_BASE = process.env.REACT_APP_API_BASE || (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");

export default function AdminApproval({ token, onClose, defaultTab = "users", embedded = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { showSuccess, showError, showConfirm } = useToast();
  const [activeTab, setActiveTab] = useState(defaultTab); // 'users', 'audio', 'scores', or 'system'
  const [users, setUsers] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [audioResources, setAudioResources] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // 用户管理相关状态
  const [userFilters, setUserFilters] = useState({
    role: "",
    is_active: "",
    is_approved: "",
    search: "",
    page: 1,
    page_size: 20,
  });
  const [userStats, setUserStats] = useState(null);
  const [experimentOverview, setExperimentOverview] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [userTotal, setUserTotal] = useState(0);
  
  // 音频资源管理相关状态
  const [audioFilters, setAudioFilters] = useState({
    category: "",
    is_public: "",
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
  const [audioStats, setAudioStats] = useState(null);
  const [editingAudio, setEditingAudio] = useState(null);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [audioTotal, setAudioTotal] = useState(0);
  const [audioViewMode, setAudioViewMode] = useState("grid"); // "grid" or "list"
  const [audioFormats, setAudioFormats] = useState([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const searchDebounceRef = useRef(null);
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
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedAudio, setSelectedAudio] = useState([]);

  // 评分管理相关状态
  const [scores, setScores] = useState([]);
  const [loadingScores, setLoadingScores] = useState(false);
  const [scoreFilters, setScoreFilters] = useState({
    user_id: "",
    task_id: "",
    algorithm: "",
    stem_name: "",
  });
  const [blindTaskId, setBlindTaskId] = useState("");
  const [generatingBlind, setGeneratingBlind] = useState(false);

  const generateBlindSamples = async () => {
    if (!blindTaskId.trim()) { showError("请输入已完成的任务ID"); return; }
    setGeneratingBlind(true);
    try {
      const resp = await fetch(`${API_BASE}/api/blind-samples/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: Number(blindTaskId.trim()) }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "生成盲化样本失败");
      showSuccess(`已生成/复用 ${data.created_or_existing || 0} 个 15 秒盲化样本`);
    } catch (e) { showError(e.message || "生成盲化样本失败"); }
    finally { setGeneratingBlind(false); }
  };
  const [, setEditingScore] = useState(null);

  // 专家建议列表（管理员侧查看与回复）
  const [expertMessages, setExpertMessages] = useState([]);
  const [expertMessagesTotal, setExpertMessagesTotal] = useState(0);
  const [expertMessagesPage, setExpertMessagesPage] = useState(1);
  const [expertMessagesPageSize] = useState(10);
  const [loadingExpertMessages, setLoadingExpertMessages] = useState(false);
  const [replyingMessage, setReplyingMessage] = useState(null);
  const [replyContent, setReplyContent] = useState("");

  // Keep state in sync if parent changes defaultTab (e.g. via URL).
  useEffect(() => {
    if (defaultTab && activeTab !== defaultTab) setActiveTab(defaultTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTab]);

  // URL -> activeTab
  useEffect(() => {
    const pathname = (location?.pathname || "").replace(/\/+$/, "") || "/";
    if (!(pathname === "/admin" || pathname.startsWith("/admin/"))) return;

    const tabFromPath =
      pathname.startsWith("/admin/audio")
        ? "audio"
        : pathname.startsWith("/admin/scores")
          ? "scores"
          : pathname.startsWith("/admin/system")
            ? "system"
            : "users";

    if (activeTab !== tabFromPath) setActiveTab(tabFromPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // activeTab -> URL (avoid clobbering /admin/system/* deep paths)
  useEffect(() => {
    const pathname = (location?.pathname || "").replace(/\/+$/, "") || "/";
    if (!(pathname === "/admin" || pathname.startsWith("/admin/"))) return;

    const target =
      activeTab === "audio"
        ? "/admin/audio"
        : activeTab === "scores"
          ? "/admin/scores"
          : activeTab === "system"
            ? "/admin/system"
            : "/admin/users";

    if (activeTab === "system" && pathname.startsWith("/admin/system/")) return;
    if (pathname !== target) navigate(target, { replace: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (userFilters.role) params.append("role", userFilters.role);
      if (userFilters.is_active !== "") {
        // 确保布尔值被正确传递
        const isActiveValue = userFilters.is_active === "true" ? "true" : userFilters.is_active === "false" ? "false" : userFilters.is_active;
        params.append("is_active", isActiveValue);
      }
      if (userFilters.is_approved !== "") {
        // 确保布尔值被正确传递
        const isApprovedValue = userFilters.is_approved === "true" ? "true" : userFilters.is_approved === "false" ? "false" : userFilters.is_approved;
        params.append("is_approved", isApprovedValue);
      }
      if (userFilters.search) params.append("search", userFilters.search);
      // 确保page和page_size是数字字符串
      params.append("page", String(Number(userFilters.page) || 1));
      params.append("page_size", String(Number(userFilters.page_size) || 20));

      const resp = await fetch(`${API_BASE}/api/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        let errBody;
        try {
          errBody = await resp.json();
        } catch (e) {
          errBody = await resp.text();
        }
        console.error("获取用户列表失败，返回体:", errBody);
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
          message = JSON.stringify(errBody) || "获取用户列表失败";
        }
        throw new Error(message);
      }
      const data = await resp.json();
      setUsers(data.items || []);
      setUserTotal(data.total || 0);
    } catch (err) {
      showError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchExperimentOverview = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/overview`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setExperimentOverview(await resp.json());
    } catch (err) {
      console.error("获取实验状态总览失败:", err);
      setExperimentOverview(null);
    }
  };

  const fetchUserStats = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/users/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        let errBody;
        try {
          errBody = await resp.json();
        } catch (e) {
          errBody = await resp.text();
        }
        console.error("获取用户统计失败，返回体:", errBody);
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
          message = JSON.stringify(errBody) || "获取统计信息失败";
        }
        throw new Error(message);
      }
      const data = await resp.json();
      setUserStats(data);
    } catch (err) {
      console.error("获取统计信息失败:", err);
      showError(formatErrorMessage(err));
    }
  };

  const fetchPendingUsers = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/auth/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("获取待审批用户列表失败");
      const data = await resp.json();
      setPendingUsers(data || []);
    } catch (err) {
      console.error("获取待审批用户失败:", err);
      showError(formatErrorMessage(err));
    }
  };

  const handleApproveApplication = async (appId) => {
    try {
      const resp = await fetch(`${API_BASE}/api/auth/approve_application/${appId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const error = await resp.json();
        throw new Error(error.detail || "审批失败");
      }
      showSuccess("已批准申请。");
      fetchPendingUsers();
      fetchUsers();
      fetchUserStats();
    } catch (err) {
      showError(formatErrorMessage(err));
    }
  };

  const handleRejectApplication = async (appId, reason) => {
    showConfirm("确认拒绝该申请？", async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/auth/reject_application/${appId}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reason ? { reason } : {}),
        });
        if (!resp.ok) {
          const error = await resp.json();
          throw new Error(error.detail || "拒绝失败");
        }
        showSuccess("已拒绝申请。");
        fetchPendingUsers();
        fetchUserStats();
      } catch (err) {
        showError(formatErrorMessage(err));
      }
    });
  };

  // 防抖搜索
  const debouncedSearch = useCallback((searchValue) => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setAudioFilters(prev => ({ ...prev, search: searchValue, page: 1 }));
    }, 300);
  }, []);

  const fetchAudioResources = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (audioFilters.category) params.append("category", audioFilters.category);
      if (audioFilters.is_public !== "") {
        const isPublicValue = audioFilters.is_public === "true" ? "true" : audioFilters.is_public === "false" ? "false" : audioFilters.is_public;
        params.append("is_public", isPublicValue);
      }
      if (audioFilters.search) params.append("search", audioFilters.search);
      if (audioFilters.uploader) params.append("uploader", audioFilters.uploader);
      if (audioFilters.file_format) params.append("file_format", audioFilters.file_format);
      if (audioFilters.min_duration) params.append("min_duration", audioFilters.min_duration);
      if (audioFilters.max_duration) params.append("max_duration", audioFilters.max_duration);
      if (audioFilters.min_size) params.append("min_size", audioFilters.min_size);
      if (audioFilters.max_size) params.append("max_size", audioFilters.max_size);
      params.append("sort_by", audioFilters.sort_by);
      params.append("sort_order", audioFilters.sort_order);
      params.append("page", String(Number(audioFilters.page) || 1));
      params.append("page_size", String(Number(audioFilters.page_size) || 20));

      const resp = await fetch(`${API_BASE}/api/admin/audio?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        let errBody;
        try {
          errBody = await resp.json();
        } catch (e) {
          errBody = await resp.text();
        }
        console.error("获取音频资源列表失败，返回体:", errBody);
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
          message = JSON.stringify(errBody) || "获取音频资源列表失败";
        }
        throw new Error(message);
      }
      const data = await resp.json();
      // 去重，确保没有重复的资源
      const uniqueResources = (data.items || []).reduce((acc, resource) => {
        if (!acc.find(r => r.id === resource.id)) {
          acc.push(resource);
        }
        return acc;
      }, []);
      setAudioResources(uniqueResources);
      setAudioTotal(data.total || 0);
    } catch (err) {
      showError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchAudioFormats = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/audio/formats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      setAudioFormats(data.formats || []);
    } catch (err) {
      console.error("获取格式失败:", err);
    }
  };

  const fetchAudioStats = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/audio/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        let errBody;
        try {
          errBody = await resp.json();
        } catch (e) {
          errBody = await resp.text();
        }
        console.error("获取音频统计失败，返回体:", errBody);
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
          message = JSON.stringify(errBody) || "获取统计信息失败";
        }
        throw new Error(message);
      }
      const data = await resp.json();
      setAudioStats(data);
    } catch (err) {
      console.error("获取统计信息失败:", err);
      showError(formatErrorMessage(err));
    }
  };

  const fetchScores = async () => {
    setLoadingScores(true);
    try {
      const params = new URLSearchParams();
      // 简单筛选：专家ID / 任务ID / 算法 / 声部名称
      if (scoreFilters.user_id) params.append("user_id", scoreFilters.user_id.trim());
      if (scoreFilters.task_id) params.append("task_id", scoreFilters.task_id.trim());
      if (scoreFilters.algorithm) params.append("algorithm", scoreFilters.algorithm.trim());
      if (scoreFilters.stem_name) params.append("stem_name", scoreFilters.stem_name.trim());
      // 默认一次拉取最多 200 条，避免数据过多
      params.append("skip", "0");
      params.append("limit", "200");

      const resp = await fetch(`${API_BASE}/api/scores?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        let errBody;
        try {
          errBody = await resp.json();
        } catch (e) {
          errBody = await resp.text();
        }
        console.error("获取评分列表失败，返回体:", errBody);
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
          message = JSON.stringify(errBody) || "获取评分列表失败";
        }
        throw new Error(message);
      }
      const data = await resp.json();
      setScores(data || []);
    } catch (err) {
      showError(formatErrorMessage(err));
    } finally {
      setLoadingScores(false);
    }
  };

  const fetchExpertMessages = async (pageOverride) => {
    setLoadingExpertMessages(true);
    try {
      const page = pageOverride || expertMessagesPage || 1;
      const params = new URLSearchParams();
      params.append("page", String(page));
      params.append("page_size", String(expertMessagesPageSize));

      const resp = await fetch(`${API_BASE}/api/messages/admin?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body || "获取专家建议失败");
      }
      const data = await resp.json();
      setExpertMessages(data.items || []);
      setExpertMessagesTotal(data.total || 0);
      setExpertMessagesPage(data.page || page);
    } catch (err) {
      console.error("获取专家建议失败:", err);
      showError(formatErrorMessage(err));
    } finally {
      setLoadingExpertMessages(false);
    }
  };

  const handleReplyExpertMessage = async () => {
    if (!replyingMessage || !replyContent.trim()) {
      showError("请填写回复内容");
      return;
    }
    try {
      const resp = await fetch(`${API_BASE}/api/messages/admin/${replyingMessage.id}/reply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reply_content: replyContent.trim() }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body || "回复失败");
      }
      showSuccess("回复已发送给专家");
      setReplyingMessage(null);
      setReplyContent("");
      fetchExpertMessages();
    } catch (err) {
      console.error("回复专家建议失败:", err);
      showError(formatErrorMessage(err));
    }
  };

  const handleUpdateUser = async (userId, updates) => {
    try {
      const resp = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      if (!resp.ok) {
        const error = await resp.json();
        throw new Error(error.detail || "更新失败");
      }
      showSuccess("用户信息已更新");
      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      showError(err.message);
    }
  };

  const handleDeleteUser = async (user) => {
    if (!user || !user.id) {
      showError("无效的用户信息");
      return;
    }
    const isExpert = user.role === "expert";
    const targetLabel = isExpert
      ? "此专家账号及其所有关联数据（分离任务、评分记录、音频资源、专家建议等）"
      : "此用户";

    showConfirm(`确定要删除${targetLabel}吗？此操作不可恢复。`, async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/admin/users/${user.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error("删除失败");
        showSuccess(isExpert ? "专家及其关联数据已删除" : "用户已删除");
        fetchUsers();
        fetchUserStats();
      } catch (err) {
        showError(err.message);
      }
    });
  };

  const handleUploadAudio = async () => {
    const {
      mixtureFile,
      vocalsFile,
      drumsFile,
      bassFile,
      otherFile,
      title,
      description,
      category,
    } = uploadForm;

    if (
      !mixtureFile ||
      !vocalsFile ||
      !drumsFile ||
      !bassFile ||
      !otherFile ||
      !title.trim()
    ) {
      showError("请补全 Mixture、4 条 Gold Standard 及标题。");
      return;
    }
    
    // 验证文件大小（100MB限制，任意单个文件超限即拒绝）
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    const filesToCheck = [mixtureFile, vocalsFile, drumsFile, bassFile, otherFile];
    for (const f of filesToCheck) {
      if (f && f.size > MAX_FILE_SIZE) {
        showError(`文件大小超过限制（最大 ${MAX_FILE_SIZE / (1024 * 1024)}MB）`);
        return;
      }
    }
    
    // 验证标题长度
    if (title.trim().length === 0) {
      showError("标题不能为空");
      return;
    }
    if (title.length > 255) {
      showError("标题长度不能超过255个字符");
      return;
    }
    
    setUploadingAudio(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append("mixture", mixtureFile);
      formData.append("vocals", vocalsFile);
      formData.append("drums", drumsFile);
      formData.append("bass", bassFile);
      formData.append("other", otherFile);
      formData.append("title", title.trim());
      if (description) formData.append("description", description.trim());
      if (category) formData.append("category", category.trim());

      // 使用 XMLHttpRequest 来显示上传进度
      const xhr = new XMLHttpRequest();
      const promise = new Promise((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            setUploadProgress(percentComplete);
          }
        });
        
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const error = JSON.parse(xhr.responseText);
              reject(new Error(error.detail || "上传失败"));
            } catch {
              reject(new Error("上传失败"));
            }
          }
        });
        
        xhr.addEventListener("error", () => {
          reject(new Error("上传失败：网络错误"));
        });
        
        xhr.open("POST", `${API_BASE}/api/audio/resources/upload-bundle`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(formData);
      });
      
      await promise;
      showSuccess("上传成功：已保存 Mixture 及 4 条 Gold Standard。");
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
      setUploadProgress(0);
      fetchAudioResources();
      fetchAudioStats();
    } catch (err) {
      showError(err.message);
    } finally {
      setUploadingAudio(false);
      setUploadProgress(0);
    }
  };

  const handleUpdateAudio = async (resourceId, updates) => {
    try {
      // 直接使用字符串类型的 ID，避免大整数精度丢失
      const id = String(resourceId);
      if (!id || id === 'undefined' || id === 'null') {
        throw new Error("无效的资源ID");
      }
      const resp = await fetch(`${API_BASE}/api/admin/audio/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      if (!resp.ok) {
        const error = await resp.json();
        throw new Error(error.detail || "更新失败");
      }
      showSuccess("音频资源信息已更新");
      setEditingAudio(null);
      fetchAudioResources();
    } catch (err) {
      showError(err.message);
    }
  };

  const handleDeleteAudio = async (resourceId) => {
    showConfirm("确定要删除此音频资源吗？此操作不可恢复。", async () => {
      try {
        // 直接使用字符串类型的 ID，避免大整数精度丢失
        const id = String(resourceId);
        if (!id || id === 'undefined' || id === 'null') {
          throw new Error("无效的资源ID");
        }
        const resp = await fetch(`${API_BASE}/api/admin/audio/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          const error = await resp.json().catch(() => ({}));
          throw new Error(error.detail || `删除失败: ${resp.status} ${resp.statusText}`);
        }
        showSuccess("音频资源已删除");
        fetchAudioResources();
        fetchAudioStats();
      } catch (err) {
        showError(err.message);
      }
    });
  };

  const handleDeleteScore = async (scoreId) => {
    showConfirm("确定要删除此评分记录吗？此操作不可恢复。", async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/scores/${scoreId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          const error = await resp.json().catch(() => ({}));
          throw new Error(error.detail || "删除评分失败");
        }
        showSuccess("评分记录已删除");
        fetchScores();
      } catch (err) {
        showError(err.message || "删除评分失败");
      }
    });
  };

  const handleBatchDeleteAudio = async () => {
    if (selectedAudio.length === 0) {
      showError("请至少选择一个音频资源");
      return;
    }
    showConfirm(`确定要删除选中的 ${selectedAudio.length} 个音频资源吗？此操作不可恢复。`, async () => {
      try {
        // 确保所有 ID 都是有效的（保持原始类型，后端会处理）
        const ids = selectedAudio.map(id => {
          // 如果是字符串，尝试转换为数字（用于大整数）
          if (typeof id === 'string') {
            // 对于大整数，直接使用字符串；对于普通数字，转换为数字
            const num = Number(id);
            return isNaN(num) || !Number.isSafeInteger(num) ? id : num;
          }
          return id;
        }).filter(id => id !== null && id !== undefined);
        if (ids.length === 0) {
          throw new Error("无效的资源ID");
        }
        
        const resp = await fetch(`${API_BASE}/api/admin/audio/batch_delete`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(ids),
        });
        if (!resp.ok) {
          const error = await resp.json().catch(() => ({}));
          throw new Error(error.detail || `批量删除失败: ${resp.status} ${resp.statusText}`);
        }
        const data = await resp.json();
        showSuccess(data.message);
        setSelectedAudio([]);
        fetchAudioResources();
        fetchAudioStats();
      } catch (err) {
        showError(err.message);
      }
    });
  };


  // 快捷筛选
  const applyQuickFilter = (type) => {
    const newFilters = { ...audioFilters, page: 1 };
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
        newFilters.min_duration = 300;
        break;
      case "short":
        newFilters.max_duration = 180;
        break;
      default:
        break;
    }
    setAudioFilters(newFilters);
  };

  const clearQuickFilter = () => {
    setAudioFilters({
      ...audioFilters,
      min_duration: "",
      max_duration: "",
      page: 1,
    });
  };

  useEffect(() => {
    if (activeTab === "users") {
      fetchUsers();
      fetchUserStats();
      fetchPendingUsers();
      fetchExperimentOverview();
    } else if (activeTab === "audio") {
      fetchAudioResources();
      fetchAudioStats();
      fetchAudioFormats();
    } else if (activeTab === "scores") {
      fetchScores();
    } else if (activeTab === "system") {
      // 系统管理页内部已经自己根据 URL 决定展示内容
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userFilters, audioFilters]);

  // 单独拉取一次专家建议数据（放在 users 页下方的“专家建议”模块）
  useEffect(() => {
    if (activeTab === "users") {
      fetchExpertMessages(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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

  const handleSystemNavClick = (targetPath) => {
    // 为系统相关页面分配独立 URL，例如 /admin/system/logs 等
    const path = targetPath || "/admin/system/logs";
    navigate(path);
  };

  const content = (
    <div
      className={`${embedded ? '' : 'bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700'} w-full ${
        embedded ? '' : 'max-w-7xl max-h-[90vh]'
      } overflow-hidden flex flex-col`}
    >
      {/* Header */}
      {!embedded && (
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white">管理员后台</h2>
            <p className="text-sm text-slate-400 mt-1">实验数据 / 用户权限 / 评分导出 / 系统设置</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition"
          >
            <X size={20} />
          </button>
        </div>
      )}

      {/* 顶部主导航 Tabs（为保持风格统一，这里展示所有一级入口） */}
      <div className="flex border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => navigate("/admin/users")}
          className={`flex items-center gap-2 px-6 py-4 font-medium transition ${
            activeTab === "users"
              ? "text-cyan-400 border-b-2 border-cyan-400"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
          }`}
        >
          <Users size={18} />
          用户管理
        </button>
        <button
          onClick={() => navigate("/admin/audio")}
          className={`flex items-center gap-2 px-6 py-4 font-medium transition ${
            activeTab === "audio"
              ? "text-cyan-400 border-b-2 border-cyan-400"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
          }`}
        >
          <Music size={18} />
          实验音频
        </button>
        <button
          onClick={() => navigate("/admin/scores")}
          className={`flex items-center gap-2 px-6 py-4 font-medium transition ${
            activeTab === "scores"
              ? "text-cyan-400 border-b-2 border-cyan-400"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
          }`}
        >
          <Award size={18} />
          评分与导出
        </button>
        <button
          onClick={() => handleSystemNavClick("/admin/system/settings")}
          className={`flex items-center gap-2 px-6 py-4 font-medium transition ${
            (location.pathname || "").startsWith("/admin/system/settings")
              ? "text-cyan-400 border-b-2 border-cyan-400"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
          }`}
        >
          <Settings size={18} />
          系统设置
        </button>
        <button
          onClick={() => handleSystemNavClick("/admin/system/analytics")}
          className={`flex items-center gap-2 px-6 py-4 font-medium transition ${
            (location.pathname || "").startsWith("/admin/system/analytics")
              ? "text-cyan-400 border-b-2 border-cyan-400"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
          }`}
        >
          <BarChart3 size={18} />
          数据统计
        </button>
        <button
          onClick={() => handleSystemNavClick("/admin/system/tasks")}
          className={`flex items-center gap-2 px-6 py-4 font-medium transition ${
            (location.pathname || "").startsWith("/admin/system/tasks")
              ? "text-cyan-400 border-b-2 border-cyan-400"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
          }`}
        >
          <Activity size={18} />
          分离任务历史
        </button>
      </div>


        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "users" ? (
            <div className="space-y-6">
              {experimentOverview && (
                <div className="rounded-xl border border-cyan-200 dark:border-cyan-900/60 bg-cyan-50/70 dark:bg-cyan-950/20 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-800 dark:text-white">实验状态总览</h3>
                      <p className="text-xs text-slate-500 mt-1">用于确认数据准备、盲化评分和导出进度</p>
                    </div>
                    <button type="button" onClick={fetchExperimentOverview} className="text-xs text-cyan-600 dark:text-cyan-300 hover:underline">刷新</button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                      ["实验音频", experimentOverview.audio_resources, "text-cyan-500"],
                      ["已完成任务", experimentOverview.completed_tasks, "text-emerald-500"],
                      ["盲化样本", experimentOverview.blind_samples, "text-indigo-500"],
                      ["已提交评分", experimentOverview.submitted_scores, "text-purple-500"],
                      ["待审批用户", experimentOverview.pending_users, "text-amber-500"],
                      ["用户总数", experimentOverview.users, "text-slate-500"],
                    ].map(([label, value, color]) => (
                      <div key={label} className="rounded-lg bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 px-3 py-3">
                        <div className="text-xs text-slate-500 truncate">{label}</div>
                        <div className={`text-2xl font-bold mt-1 ${color}`}>{value ?? 0}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 用户统计 */}
              {userStats && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-400">总用户数</div>
                    <div className="text-2xl font-bold text-slate-800 dark:text-white mt-1">{userStats.total}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-400">已激活</div>
                    <div className="text-2xl font-bold text-emerald-400 mt-1">{userStats.active}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-400">未激活</div>
                    <div className="text-2xl font-bold text-red-400 mt-1">{userStats.inactive}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-400">已审批</div>
                    <div className="text-2xl font-bold text-cyan-400 mt-1">{userStats.approved}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-400">待审批</div>
                    <div className="text-2xl font-bold text-yellow-400 mt-1">{userStats.pending}</div>
                  </div>
                </div>
              )}

              {/* 待审批用户列表 */}
              {pendingUsers.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="p-4 border-b border-slate-200 dark:border-b-slate-700">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                      <CheckCircle size={20} className="text-yellow-400" />
                      待审批用户 ({pendingUsers.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 dark:bg-slate-900">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">ID</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">用户名</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">邮箱</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">申请角色</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">申请时间</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {pendingUsers.map((pending, index) => (
                          <tr
                            key={`pending-${String(pending.id)}-${pending.username || index}`}
                            className="hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                          >
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{pending.id}</td>
                            <td className="px-4 py-3 text-sm text-slate-800 dark:text-white font-medium">
                              {pending.username}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{pending.email}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`px-2 py-1 text-xs rounded ${
                                  pending.role === "admin"
                                    ? "bg-red-500/20 text-red-300"
                                    : "bg-purple-500/20 text-purple-300"
                                }`}
                              >
                                {pending.role === "admin" ? "管理员" : "专家"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-400">
                              {new Date(pending.created_at).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleApproveApplication(pending.id)}
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs transition flex items-center gap-1"
                                >
                                  <CheckCircle size={14} />
                                  批准
                                </button>
                                <button
                                  onClick={() => {
                                    const reason = window.prompt("请输入拒绝原因（可选）：");
                                    handleRejectApplication(pending.id, reason);
                                  }}
                                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs transition flex items-center gap-1"
                                >
                                  <XCircle size={14} />
                                  拒绝
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 筛选器 */}
              <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">角色</label>
                    <select
                      value={userFilters.role}
                      onChange={(e) => setUserFilters({ ...userFilters, role: e.target.value, page: 1 })}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                    >
                      <option value="">全部</option>
                      <option value="expert">专家</option>
                      <option value="admin">管理员</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">激活状态</label>
                    <select
                      value={userFilters.is_active}
                      onChange={(e) => setUserFilters({ ...userFilters, is_active: e.target.value, page: 1 })}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                    >
                      <option value="">全部</option>
                      <option value="true">已激活</option>
                      <option value="false">未激活</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">审批状态</label>
                    <select
                      value={userFilters.is_approved}
                      onChange={(e) => setUserFilters({ ...userFilters, is_approved: e.target.value, page: 1 })}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                    >
                      <option value="">全部</option>
                      <option value="true">已审批</option>
                      <option value="false">未审批</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-slate-400 mb-2">搜索</label>
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={userFilters.search}
                        onChange={(e) => setUserFilters({ ...userFilters, search: e.target.value, page: 1 })}
                        placeholder="搜索用户名或邮箱..."
                        className="w-full pl-10 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 用户列表 */}
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-slate-900">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">用户名</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">邮箱</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">角色</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">状态</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">创建时间</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {loading ? (
                        <tr>
                          <td colSpan="7" className="px-4 py-8 text-center text-slate-400">
                            加载中...
                          </td>
                        </tr>
                      ) : users.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="px-4 py-8 text-center text-slate-400">
                            暂无用户
                          </td>
                        </tr>
                      ) : (
                        users.map((user, index) => (
                          <tr key={`user-${String(user.id)}-${user.username || index}`} className="hover:bg-slate-200/50 dark:hover:bg-slate-700/50">
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={selectedUsers.includes(user.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedUsers([...selectedUsers, user.id]);
                                  } else {
                                    setSelectedUsers(selectedUsers.filter((id) => id !== user.id));
                                  }
                                }}
                                className="rounded"
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{user.id}</td>
                            <td className="px-4 py-3 text-sm text-slate-800 dark:text-white font-medium">{user.username}</td>
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{user.email}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`px-2 py-1 text-xs rounded ${
                                  user.role === "admin"
                                    ? "bg-red-500/20 text-red-300"
                                    : "bg-purple-500/20 text-purple-300"
                                }`}
                              >
                                {user.role === "admin" ? "管理员" : "专家"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1">
                                {user.is_active ? (
                                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                                    <CheckCircle size={12} /> 已激活
                                  </span>
                                ) : (
                                  <span className="text-xs text-red-400 flex items-center gap-1">
                                    <XCircle size={12} /> 未激活
                                  </span>
                                )}
                                {user.is_approved ? (
                                  <span className="text-xs text-cyan-400">已审批</span>
                                ) : (
                                  <span className="text-xs text-yellow-400">待审批</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-400">
                              {new Date(user.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => setEditingUser(user)}
                                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition"
                                  title="编辑"
                                >
                                  <Edit size={16} />
                                </button>
                                <button
                                  onClick={() => handleDeleteUser(user)}
                                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
                                  title="删除"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {/* 分页 */}
                {userTotal > userFilters.page_size && (
                  <div className="px-4 py-3 border-t border-slate-700 flex items-center justify-between">
                    <div className="text-sm text-slate-400">
                      共 {userTotal} 条，第 {userFilters.page} / {Math.ceil(userTotal / userFilters.page_size)} 页
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setUserFilters({ ...userFilters, page: Math.max(1, userFilters.page - 1) })}
                        disabled={userFilters.page === 1}
                        className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded text-sm text-slate-800 dark:text-white disabled:opacity-50"
                      >
                        上一页
                      </button>
                      <button
                        onClick={() =>
                          setUserFilters({ ...userFilters, page: Math.min(Math.ceil(userTotal / userFilters.page_size), userFilters.page + 1) })
                        }
                        disabled={userFilters.page >= Math.ceil(userTotal / userFilters.page_size)}
                        className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded text-sm text-slate-800 dark:text-white disabled:opacity-50"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 专家建议 / 站内信（简单一问一答） */}
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <MessageCircle size={18} className="text-cyan-400" />
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 dark:text-white">专家建议箱</h3>
                      <p className="text-xs text-slate-400">
                        专家在前台提交的建议 / 反馈，便于管理员收集使用体验和需求。
                      </p>
                    </div>
                  </div>
                  {expertMessagesTotal > 0 && (
                    <span className="text-xs text-slate-400">
                      共 {expertMessagesTotal} 条
                    </span>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {loadingExpertMessages ? (
                    <div className="py-6 text-center text-slate-400 text-sm">
                      加载中...
                    </div>
                  ) : expertMessages.length === 0 ? (
                    <div className="py-6 text-center text-slate-500 text-sm">
                      暂无专家建议。
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-900">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-400">ID</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-400">专家ID</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-400">主题</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-400">状态</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-400">创建时间</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {expertMessages.map((m) => (
                          <tr key={m.id} className="hover:bg-slate-200/40 dark:hover:bg-slate-700/40">
                            <td className="px-4 py-2 text-slate-700 dark:text-slate-300 text-xs">{m.id}</td>
                            <td className="px-4 py-2 text-slate-700 dark:text-slate-300 text-xs">{m.expert_id}</td>
                            <td className="px-4 py-2 text-slate-700 dark:text-slate-100 text-xs max-w-xs truncate" title={m.subject}>
                              {m.subject}
                            </td>
                            <td className="px-4 py-2 text-xs">
                              {m.status === "answered" ? (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                  已回复
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
                                  待处理
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-slate-400 text-xs">
                              {m.created_at ? new Date(m.created_at).toLocaleString() : "-"}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <button
                                onClick={() => {
                                  setReplyingMessage(m);
                                  setReplyContent(m.reply_content || "");
                                }}
                                className="px-3 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100"
                              >
                                查看 / 回复
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                {expertMessagesTotal > expertMessagesPageSize && (
                  <div className="px-4 py-2 border-t border-slate-700 flex items-center justify-between">
                    <div className="text-xs text-slate-400">
                      第 {expertMessagesPage} / {Math.max(1, Math.ceil(expertMessagesTotal / expertMessagesPageSize))} 页
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const newPage = Math.max(1, expertMessagesPage - 1);
                          setExpertMessagesPage(newPage);
                          fetchExpertMessages(newPage);
                        }}
                        disabled={expertMessagesPage === 1}
                        className="px-3 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-800 dark:text-white"
                      >
                        上一页
                      </button>
                      <button
                        onClick={() => {
                          const maxPage = Math.max(1, Math.ceil(expertMessagesTotal / expertMessagesPageSize));
                          const newPage = Math.min(maxPage, expertMessagesPage + 1);
                          setExpertMessagesPage(newPage);
                          fetchExpertMessages(newPage);
                        }}
                        disabled={expertMessagesPage >= Math.ceil(expertMessagesTotal / expertMessagesPageSize)}
                        className="px-3 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-800 dark:text-white"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "audio" ? (
            <div className="space-y-6">
              {/* 音频统计 */}
              {audioStats && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-400">总资源数</div>
                    <div className="text-2xl font-bold text-slate-800 dark:text-white mt-1">{audioStats.total}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-400">公开资源</div>
                    <div className="text-2xl font-bold text-emerald-400 mt-1">{audioStats.public}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-400">私有资源</div>
                    <div className="text-2xl font-bold text-slate-400 mt-1">{audioStats.private}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-400">总下载</div>
                    <div className="text-2xl font-bold text-cyan-400 mt-1">{audioStats.total_downloads}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-400">总大小</div>
                    <div className="text-2xl font-bold text-purple-400 mt-1">{audioStats.total_size_mb} MB</div>
                  </div>
                </div>
              )}

              {/* 上传表单 */}
              <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                  <Plus size={20} />
                  上传音频资源
                </h3>
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    管理员上传音频时，也需要一次性提供 Mixture 以及对应的 4 个 Gold Standard Stem，方便后续在同一音频上进行算法对比。
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-2">Mixture（混合音） *</label>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, mixtureFile: e.target.files[0] || null })
                        }
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-2">Gold Standard Vocals *</label>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, vocalsFile: e.target.files[0] || null })
                        }
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-2">Gold Standard Drums *</label>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, drumsFile: e.target.files[0] || null })
                        }
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-2">Gold Standard Bass *</label>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, bassFile: e.target.files[0] || null })
                        }
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-2">Gold Standard Other *</label>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, otherFile: e.target.files[0] || null })
                        }
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">标题 *</label>
                    <input
                      type="text"
                      value={uploadForm.title}
                      onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                      placeholder="音频标题"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">描述</label>
                    <input
                      type="text"
                      value={uploadForm.description}
                      onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                      placeholder="音频描述"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">分类</label>
                    <input
                      type="text"
                      value={uploadForm.category}
                      onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                      placeholder="分类标签"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                    />
                  </div>
                  {/* 标签字段已废弃 */}
                </div>
                {(uploadForm.mixtureFile ||
                  uploadForm.vocalsFile ||
                  uploadForm.drumsFile ||
                  uploadForm.bassFile ||
                  uploadForm.otherFile) && (
                  <div className="mt-2 text-xs text-slate-400 space-y-1">
                    {uploadForm.mixtureFile && (
                      <div>
                        Mixture: {(uploadForm.mixtureFile.size / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    )}
                    {uploadForm.vocalsFile && (
                      <div>
                        Gold Vocals: {(uploadForm.vocalsFile.size / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    )}
                    {uploadForm.drumsFile && (
                      <div>
                        Gold Drums: {(uploadForm.drumsFile.size / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    )}
                    {uploadForm.bassFile && (
                      <div>
                        Gold Bass: {(uploadForm.bassFile.size / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    )}
                    {uploadForm.otherFile && (
                      <div>
                        Gold Other: {(uploadForm.otherFile.size / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    )}
                  </div>
                )}
                {uploadingAudio && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
                      <span>上传进度</span>
                      <span>{Math.round(uploadProgress)}%</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-cyan-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  </div>
                )}
                <button
                  onClick={handleUploadAudio}
                  disabled={
                    uploadingAudio ||
                    !uploadForm.mixtureFile ||
                    !uploadForm.vocalsFile ||
                    !uploadForm.drumsFile ||
                    !uploadForm.bassFile ||
                    !uploadForm.otherFile ||
                    !uploadForm.title.trim()
                  }
                  className="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload size={16} />
                  {uploadingAudio ? "上传中..." : "上传"}
                </button>
              </div>

              {/* 快捷筛选标签 + 视图切换 */}
              <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-400 font-medium">快捷筛选：</span>
                    <button
                      onClick={() => applyQuickFilter("hot")}
                      className="px-2.5 py-1 bg-slate-200/50 dark:bg-slate-700/50 hover:bg-cyan-600 hover:text-white text-slate-800 dark:text-white rounded-md transition text-xs flex items-center gap-1.5 font-medium"
                    >
                      <TrendingUp size={12} />
                      热门
                    </button>
                    <button
                      onClick={() => applyQuickFilter("latest")}
                      className="px-2.5 py-1 bg-slate-200/50 dark:bg-slate-700/50 hover:bg-cyan-600 hover:text-white text-slate-800 dark:text-white rounded-md transition text-xs flex items-center gap-1.5 font-medium"
                    >
                      <Clock size={12} />
                      最新
                    </button>
                    <button
                      onClick={() => applyQuickFilter("long")}
                      className="px-2.5 py-1 bg-slate-200/50 dark:bg-slate-700/50 hover:bg-cyan-600 hover:text-white text-slate-800 dark:text-white rounded-md transition text-xs flex items-center gap-1.5 font-medium"
                    >
                      <FileAudio size={12} />
                      长音频
                    </button>
                    <button
                      onClick={() => applyQuickFilter("short")}
                      className="px-2.5 py-1 bg-slate-200/50 dark:bg-slate-700/50 hover:bg-cyan-600 hover:text-white text-slate-800 dark:text-white rounded-md transition text-xs flex items-center gap-1.5 font-medium"
                    >
                      <FileAudio size={12} />
                      短音频
                    </button>
                    {(audioFilters.min_duration || audioFilters.max_duration) && (
                      <button
                        onClick={clearQuickFilter}
                        className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-md transition text-xs font-medium"
                      >
                        清除筛选
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setAudioViewMode(audioViewMode === "grid" ? "list" : "grid")}
                    className="ml-auto p-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white transition"
                    title={audioViewMode === "grid" ? "列表视图" : "卡片视图"}
                  >
                    {audioViewMode === "grid" ? <List size={18} /> : <Grid size={18} />}
                  </button>
                </div>
              </div>

              {/* 筛选器 */}
              <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                <div className="space-y-3">
                  {/* 第一行：分类、公开状态和搜索 */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-shrink-0 sm:w-40">
                      <div className="relative">
                        <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          value={audioFilters.category}
                          onChange={(e) => setAudioFilters({ ...audioFilters, category: e.target.value, page: 1 })}
                          placeholder="分类"
                      className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                        />
                      </div>
                    </div>
                    <div className="flex-shrink-0 sm:w-32">
                      <select
                        value={audioFilters.is_public}
                        onChange={(e) => setAudioFilters({ ...audioFilters, is_public: e.target.value, page: 1 })}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 appearance-none cursor-pointer"
                      >
                        <option value="">全部状态</option>
                        <option value="true">公开</option>
                        <option value="false">私有</option>
                      </select>
                    </div>
                    <div className="flex-shrink-0 sm:w-32">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          value={audioFilters.uploader}
                          onChange={(e) => setAudioFilters({ ...audioFilters, uploader: e.target.value, page: 1 })}
                          placeholder="上传者"
                          className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          value={audioFilters.search}
                          onChange={(e) => {
                            const value = e.target.value;
                            setAudioFilters(prev => ({ ...prev, search: value, page: 1 }));
                            debouncedSearch(value);
                          }}
                          placeholder="按标题搜索"
                          className="w-full pl-10 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 第二行：排序和高级筛选 */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs text-slate-400 whitespace-nowrap">排序：</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={audioFilters.sort_by}
                        onChange={(e) => setAudioFilters({ ...audioFilters, sort_by: e.target.value, page: 1 })}
                        className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 appearance-none cursor-pointer"
                      >
                        <option value="created_at">上传时间</option>
                        <option value="download_count">下载次数</option>
                        <option value="duration">时长</option>
                        <option value="file_size">文件大小</option>
                        <option value="title">标题</option>
                      </select>
                      <select
                        value={audioFilters.sort_order}
                        onChange={(e) => setAudioFilters({ ...audioFilters, sort_order: e.target.value, page: 1 })}
                        className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 appearance-none cursor-pointer"
                      >
                        <option value="desc">降序</option>
                        <option value="asc">升序</option>
                      </select>
                    </div>
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
                            value={audioFilters.file_format}
                            onChange={(e) => setAudioFilters({ ...audioFilters, file_format: e.target.value, page: 1 })}
                            className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 appearance-none cursor-pointer"
                          >
                            <option value="">全部格式</option>
                            {audioFormats.map((fmt) => (
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
                            value={audioFilters.min_duration}
                            onChange={(e) => setAudioFilters({ ...audioFilters, min_duration: e.target.value, page: 1 })}
                            placeholder="60"
                            className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1.5">最大时长（秒）</label>
                          <input
                            type="number"
                            value={audioFilters.max_duration}
                            onChange={(e) => setAudioFilters({ ...audioFilters, max_duration: e.target.value, page: 1 })}
                            placeholder="300"
                            className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1.5">文件大小（MB）</label>
                          <div className="flex gap-1.5">
                            <input
                              type="number"
                              value={audioFilters.min_size ? audioFilters.min_size / (1024 * 1024) : ""}
                              onChange={(e) => setAudioFilters({ ...audioFilters, min_size: e.target.value ? parseInt(e.target.value) * 1024 * 1024 : "", page: 1 })}
                              placeholder="最小"
                              className="flex-1 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                            />
                            <input
                              type="number"
                              value={audioFilters.max_size ? audioFilters.max_size / (1024 * 1024) : ""}
                              onChange={(e) => setAudioFilters({ ...audioFilters, max_size: e.target.value ? parseInt(e.target.value) * 1024 * 1024 : "", page: 1 })}
                              placeholder="最大"
                              className="flex-1 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 批量操作 */}
              {selectedAudio.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <span className="text-sm text-slate-700 dark:text-slate-300">已选择 {selectedAudio.length} 个音频资源</span>
                  <button
                    onClick={handleBatchDeleteAudio}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm transition"
                  >
                    批量删除
                  </button>
                </div>
              )}

              {/* 音频资源列表 */}
              {loading ? (
                <div className="text-center text-slate-400 py-8">加载中...</div>
              ) : audioResources.length === 0 ? (
                <div className="text-center text-slate-400 py-8">暂无音频资源</div>
              ) : audioViewMode === "grid" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {audioResources.map((resource, index) => (
                    <div
                      key={`audio-${resource.id}-${index}`}
                      className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-start gap-2 flex-1">
                          <input
                            type="checkbox"
                            checked={selectedAudio.includes(resource.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedAudio([...selectedAudio, resource.id]);
                              } else {
                                setSelectedAudio(selectedAudio.filter((id) => id !== resource.id));
                              }
                            }}
                            className="mt-1 rounded"
                          />
                          <h4 className="font-bold text-slate-800 dark:text-white flex-1">
                            {resource.title}
                          </h4>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingAudio(resource)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition"
                            title="编辑"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteAudio(resource.id)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {resource.description && (
                        <p className="text-sm text-slate-400 mb-3 line-clamp-2">
                          {resource.description}
                        </p>
                      )}
                      {resource.created_by && (
                        <p className="text-xs text-slate-500 mb-2">
                          上传者：
                          <button
                            onClick={() =>
                              setAudioFilters({ ...audioFilters, uploader: resource.created_by, page: 1 })
                            }
                            className="text-cyan-400 hover:text-cyan-300 hover:underline transition ml-1"
                          >
                            {resource.created_by}
                          </button>
                        </p>
                      )}
                      <div className="space-y-2 text-xs text-slate-400">
                        <div className="flex items-center justify-between">
                          <span>格式:</span>
                          <span className="text-slate-700 dark:text-slate-300">
                            {(resource.file_format || "未知").toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>大小:</span>
                          <span className="text-slate-700 dark:text-slate-300">{formatFileSize(resource.file_size)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>时长:</span>
                          <span className="text-slate-700 dark:text-slate-300">{formatDuration(resource.duration)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>下载:</span>
                          <span className="text-slate-700 dark:text-slate-300">{resource.download_count} 次</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          {resource.category && (
                            <span className="px-2 py-1 bg-cyan-500/20 text-cyan-300 rounded text-xs">
                              {resource.category}
                            </span>
                          )}
                          {resource.tags &&
                            resource.tags
                              .split(",")
                              .slice(0, 3)
                              .map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-xs"
                                >
                                  {tag.trim()}
                                </span>
                              ))}
                          {resource.is_public ? (
                            <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded text-xs">
                              公开
                            </span>
                          ) : (
                            <span className="px-2 py-1 bg-slate-500/20 text-slate-700 dark:text-slate-300 rounded text-xs">
                              私有
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {audioResources.map((resource, index) => (
                    <div
                      key={`audio-list-${resource.id}-${index}`}
                      className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 flex items-start gap-4"
                    >
                      <div>
                        <input
                          type="checkbox"
                          checked={selectedAudio.includes(resource.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAudio([...selectedAudio, resource.id]);
                            } else {
                              setSelectedAudio(selectedAudio.filter((id) => id !== resource.id));
                            }
                          }}
                          className="mt-1 rounded"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <h4 className="font-bold text-slate-800 dark:text-white truncate">{resource.title}</h4>
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              onClick={() => setEditingAudio(resource)}
                              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition"
                              title="编辑"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteAudio(resource.id)}
                              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        {resource.description && (
                          <p className="text-sm text-slate-400 mb-2 line-clamp-1">
                            {resource.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                          <span>格式：{(resource.file_format || "未知").toUpperCase()}</span>
                          <span>大小：{formatFileSize(resource.file_size)}</span>
                          <span>时长：{formatDuration(resource.duration)}</span>
                          <span>下载：{resource.download_count} 次</span>
                          {resource.created_by && (
                            <span>
                              上传者：
                              <button
                                onClick={() =>
                                  setAudioFilters({
                                    ...audioFilters,
                                    uploader: resource.created_by,
                                    page: 1,
                                  })
                                }
                                className="text-cyan-400 hover:text-cyan-300 hover:underline transition ml-1"
                              >
                                {resource.created_by}
                              </button>
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {resource.category && (
                            <span className="px-2 py-1 bg-cyan-500/20 text-cyan-300 rounded text-xs">
                              {resource.category}
                            </span>
                          )}
                          {resource.tags &&
                            resource.tags
                              .split(",")
                              .slice(0, 3)
                              .map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-xs"
                                >
                                  {tag.trim()}
                                </span>
                              ))}
                          {resource.is_public ? (
                            <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded text-xs">
                              公开
                            </span>
                          ) : (
                            <span className="px-2 py-1 bg-slate-500/20 text-slate-700 dark:text-slate-300 rounded text-xs">
                              私有
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 分页 */}
              {audioTotal > audioFilters.page_size && (
                <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="text-sm text-slate-400">
                    共 {audioTotal} 条，第 {audioFilters.page} / {Math.ceil(audioTotal / audioFilters.page_size)} 页
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAudioFilters({ ...audioFilters, page: Math.max(1, audioFilters.page - 1) })}
                      disabled={audioFilters.page === 1}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded text-sm text-slate-800 dark:text-white disabled:opacity-50"
                    >
                      上一页
                    </button>
                    <button
                      onClick={() =>
                        setAudioFilters({ ...audioFilters, page: Math.min(Math.ceil(audioTotal / audioFilters.page_size), audioFilters.page + 1) })
                      }
                      disabled={audioFilters.page >= Math.ceil(audioTotal / audioFilters.page_size)}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded text-sm text-slate-800 dark:text-white disabled:opacity-50"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === "scores" ? (
            <div className="space-y-6">
              {/* 评分筛选器 */}
              <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                  <Award size={20} className="text-cyan-400" />
                  评分管理
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">专家用户ID</label>
                    <input
                      type="text"
                      value={scoreFilters.user_id}
                      onChange={(e) =>
                        setScoreFilters((prev) => ({
                          ...prev,
                          user_id: e.target.value,
                        }))
                      }
                      placeholder="精确匹配 user_id"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">任务ID</label>
                    <input
                      type="text"
                      value={scoreFilters.task_id}
                      onChange={(e) =>
                        setScoreFilters((prev) => ({
                          ...prev,
                          task_id: e.target.value,
                        }))
                      }
                      placeholder="task_id"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">算法</label>
                    <input
                      type="text"
                      value={scoreFilters.algorithm}
                      onChange={(e) =>
                        setScoreFilters((prev) => ({
                          ...prev,
                          algorithm: e.target.value,
                        }))
                      }
                      placeholder="例如：MDX23C"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">声部名称 (stem)</label>
                    <input
                      type="text"
                      value={scoreFilters.stem_name}
                      onChange={(e) =>
                        setScoreFilters((prev) => ({
                          ...prev,
                          stem_name: e.target.value,
                        }))
                      }
                      placeholder="例如：Vocals / Drums"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm"
                    />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    onClick={() => {
                      setScoreFilters({
                        user_id: "",
                        task_id: "",
                        algorithm: "",
                        stem_name: "",
                      });
                    }}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg text-sm"
                  >
                    重置筛选
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const resp = await fetch(`${API_BASE}/api/scores/export`, { headers: { Authorization: `Bearer ${token}` } });
                        if (!resp.ok) throw new Error("导出失败");
                        const blob = await resp.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a"); a.href = url; a.download = "subjective_scores.csv"; a.click(); URL.revokeObjectURL(url);
                      } catch (e) { showError?.(e.message || "导出失败"); }
                    }}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm"
                  >
                    导出全部主观评分
                  </button>
                  <button
                    onClick={fetchScores}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm flex items-center gap-2"
                  >
                    <Search size={16} />
                    查询
                  </button>
                </div>
                <div className="mt-4 px-4 pb-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">生成 15 秒盲化样本</span>
                  <input value={blindTaskId} onChange={(e) => setBlindTaskId(e.target.value)} placeholder="已完成任务 ID" className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 text-sm" />
                  <button onClick={generateBlindSamples} disabled={generatingBlind} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm disabled:opacity-50">{generatingBlind ? "生成中..." : "生成盲化样本"}</button>
                </div>
              </div>

              {/* 评分列表 */}
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-slate-900">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">专家ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">任务ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">算法</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">声部</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">质量</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">干扰</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">伪影</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">创建时间</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {loadingScores ? (
                        <tr>
                          <td colSpan="10" className="px-4 py-8 text-center text-slate-400">
                            加载中...
                          </td>
                        </tr>
                      ) : scores.length === 0 ? (
                        <tr>
                          <td colSpan="10" className="px-4 py-8 text-center text-slate-400">
                            暂无评分记录
                          </td>
                        </tr>
                      ) : (
                        scores.map((score, index) => (
                          <tr
                            key={`score-${String(score.id)}-${index}`}
                            className="hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                          >
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{score.id}</td>
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{score.user_id}</td>
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{score.task_id}</td>
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{score.algorithm}</td>
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                              {score.stem_name || "-"}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{score.quality}</td>
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                              {score.interference}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                              {score.artifacts}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-400">
                              {score.created_at
                                ? new Date(score.created_at).toLocaleString()
                                : "-"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => setEditingScore(score)}
                                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition"
                                  title="编辑评分"
                                >
                                  <Edit size={16} />
                                </button>
                                <button
                                  onClick={() => handleDeleteScore(score.id)}
                                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
                                  title="删除评分"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : activeTab === "system" ? (
            <SystemManagement token={token} />
          ) : null}
        </div>
    </div>
  );

  return (
    <>
      {embedded ? content : (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          {content}
        </div>
      )}
      {/* 编辑用户模态框 */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h3 className="text-xl font-bold text-slate-800 dark:text-white">编辑用户</h3>
              <button
                onClick={() => setEditingUser(null)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">用户名</label>
                <input
                  type="text"
                  value={editingUser.username}
                  onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">邮箱</label>
                <input
                  type="email"
                  value={editingUser.email}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">角色</label>
                <select
                  value={editingUser.role}
                  onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white"
                >
                  <option value="expert">专家</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={editingUser.is_active}
                    onChange={(e) => setEditingUser({ ...editingUser, is_active: e.target.checked })}
                    className="rounded"
                  />
                  已激活
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={editingUser.is_approved}
                    onChange={(e) => setEditingUser({ ...editingUser, is_approved: e.target.checked })}
                    className="rounded"
                  />
                  已审批
                </label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditingUser(null)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg transition"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    const { id, ...updates } = editingUser;
                    handleUpdateUser(id, updates);
                  }}
                  className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Save size={16} />
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 编辑音频资源模态框 */}
      {editingAudio && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h3 className="text-xl font-bold text-slate-800 dark:text-white">编辑音频资源</h3>
              <button
                onClick={() => setEditingAudio(null)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">标题</label>
                <input
                  type="text"
                  value={editingAudio.title}
                  onChange={(e) => setEditingAudio({ ...editingAudio, title: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">描述</label>
                <textarea
                  value={editingAudio.description || ""}
                  onChange={(e) => setEditingAudio({ ...editingAudio, description: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white"
                  rows="3"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">分类</label>
                <input
                  type="text"
                  value={editingAudio.category || ""}
                  onChange={(e) => setEditingAudio({ ...editingAudio, category: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">标签</label>
                <input
                  type="text"
                  value={editingAudio.tags || ""}
                  onChange={(e) => setEditingAudio({ ...editingAudio, tags: e.target.value })}
                  placeholder="标签1,标签2"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">公开状态</label>
                <select
                  value={editingAudio.is_public}
                  onChange={(e) => setEditingAudio({ ...editingAudio, is_public: e.target.value === "true" })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white"
                >
                  <option value="true">公开</option>
                  <option value="false">私有</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditingAudio(null)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg transition"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    const { id, ...updates } = editingAudio;
                    handleUpdateAudio(id, updates);
                  }}
                  className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Save size={16} />
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 管理员回复专家建议模态框 */}
      {replyingMessage && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <MessageCircle size={18} className="text-cyan-400" />
                回复专家建议
              </h3>
              <button
                onClick={() => {
                  setReplyingMessage(null);
                  setReplyContent("");
                }}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <div className="text-xs text-slate-400 mb-1">主题</div>
                <div className="text-sm text-slate-100">
                  {replyingMessage.subject}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400 mb-1">专家内容</div>
                <div className="text-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {replyingMessage.content}
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  管理员回复
                </label>
                <textarea
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white text-sm resize-none"
                  placeholder="请输入要回复给专家的内容"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setReplyingMessage(null);
                    setReplyContent("");
                  }}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg transition"
                >
                  取消
                </button>
                <button
                  onClick={handleReplyExpertMessage}
                  className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Save size={16} />
                  发送回复
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
