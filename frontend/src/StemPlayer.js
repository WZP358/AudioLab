import { useRef, useState, useEffect, useMemo } from "react";
import { Play, Pause, Download } from "lucide-react";

// 1 帧 44.1 kHz 16-bit 单声道 WAVE 文件（44 字节头 + 2 字节采样）
function createSilenceWav() {
  const sampleRate = 44100;
  const numSamples = 1;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // WAVE 头
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++)
      view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // 16 bits
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);

  // 1 个非零采样
  view.setInt16(44, 5000, true);

  return new Blob([buffer], { type: "audio/wav" });
}

export default function StemPlayer({ name, file, src, onSelect, onPlaybackStateChange, onUserSeek, syncedTime, theme = "cyan" }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // 主题色配置
  const themeColors = {
    cyan: {
      button: "bg-cyan-600 hover:bg-cyan-500",
      accent: "accent-cyan-500",
    },
    purple: {
      button: "bg-purple-600 hover:bg-purple-500",
      accent: "accent-purple-500",
    },
  };
  
  const colors = themeColors[theme] || themeColors.cyan;

  // 保存上一个 URL 和文件对象，用于清理和避免重复创建
  const prevUrlRef = useRef(null);
  const fileRef = useRef(null);
  
  // 生成文件唯一标识（用于判断文件是否改变）
  const getFileId = (f) => {
    if (!f) return null;
    return `${f.name}-${f.size}-${f.lastModified}`;
  };
  
  const url = useMemo(() => {
    if (typeof src === "string" && src.length > 0) return src;
    
    if (file instanceof File) {
      // 使用文件标识符判断是否是同一个文件（文件名+大小+修改时间）
      const fileId = getFileId(file);
      const prevFileId = fileRef.current ? getFileId(fileRef.current) : null;
      
      // 只有当文件标识符相同且名称也相同时，才复用 URL
      // 这样可以确保不同的 stem（即使大小相同）也会创建新的 URL
      if (fileId === prevFileId && file.name === fileRef.current?.name && prevUrlRef.current && prevUrlRef.current.startsWith('blob:')) {
        console.log(`[StemPlayer] 复用已有 URL: ${prevUrlRef.current} (${name}, fileId: ${fileId})`);
        return prevUrlRef.current;
      }
      
      try {
        const objectUrl = URL.createObjectURL(file);
        console.log(`[StemPlayer] 创建 object URL 成功: ${name}`, {
          url: objectUrl,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          fileId: fileId,
          prevFileId: prevFileId,
        });
        fileRef.current = file;
        prevUrlRef.current = objectUrl; // 立即更新 prevUrlRef，避免重复创建
        return objectUrl;
      } catch (e) {
        console.warn(`[StemPlayer] 无法创建文件 URL (${name}):`, e, {
          file,
          fileType: typeof file,
          isFile: file instanceof File,
        });
        return null;
      }
    }
    
    // 如果没有 src 也没有 file，返回 null（不创建占位文件，因为用户明确上传了文件）
    if (!file && !src) {
      console.warn(`[StemPlayer] 没有有效的音频源 (${name})`);
      return null;
    }
    
    // 兼容旧的 mock：用一个很小的 wav 占位（仅在没有明确文件时）
    try {
      const realFile = new File([createSilenceWav()], `${name || "stem"}.wav`, {
        type: "audio/wav",
      });
      return URL.createObjectURL(realFile);
    } catch (e) {
      console.warn(`[StemPlayer] 无法创建占位音频 URL (${name}):`, e);
      return null;
    }
  }, [src, file, name]);
  
  // 当 URL 改变时，强制更新音频元素的 src
  useEffect(() => {
    const audio = audioRef.current;
    if (audio && url) {
      // 如果 URL 改变了，强制更新 src
      if (audio.src !== url) {
        console.log(`[StemPlayer] 更新音频源: ${name}`, {
          oldSrc: audio.src,
          newSrc: url,
          fileName: file?.name,
        });
        audio.src = url;
        audio.load(); // 重新加载音频
      }
    }
  }, [url, name, file]);

  useEffect(() => {
    // 只有当 URL 真正改变时才清理上一个 URL
    // 延迟回收，确保音频元素已经切换到新 URL
    if (prevUrlRef.current && prevUrlRef.current !== url && prevUrlRef.current.startsWith('blob:')) {
      const urlToRevoke = prevUrlRef.current;
      // 延迟回收，给音频元素时间切换到新 URL
      const timeoutId = setTimeout(() => {
        try {
          // 检查音频元素是否还在使用旧 URL
          if (audioRef.current && audioRef.current.src === urlToRevoke) {
            console.log(`[StemPlayer] 延迟回收 URL（仍在使用的 URL，跳过）: ${urlToRevoke}`);
            return; // 仍在使用的 URL 不回收
          }
          URL.revokeObjectURL(urlToRevoke);
          console.log(`[StemPlayer] 回收上一个 URL: ${urlToRevoke}`);
        } catch (e) {
          console.warn(`[StemPlayer] 回收 URL 失败:`, e);
        }
      }, 500); // 延迟 500ms 回收，确保音频元素已经切换
      
      // 清理函数：如果组件在延迟期间卸载，取消回收
      return () => {
        clearTimeout(timeoutId);
      };
    }
    // 保存当前 URL
    prevUrlRef.current = url;
    
    // 组件卸载时：不立即回收 URL，让浏览器在页面关闭时自动回收
    // 这样可以避免音频元素还在使用时 URL 被回收
    return () => {
      // 不在这里回收 URL，避免音频元素还在使用时被回收
      // 浏览器会在页面关闭时自动回收所有 blob URL
    };
  }, [url]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el || !url) {
      console.warn("无法播放：音频元素或 URL 不存在");
      return;
    }
    if (el.paused) {
      el.play().catch((e) => {
        console.error("播放失败:", e);
        setPlaying(false);
      });
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = file?.name || `${name || "stem"}.wav`;
    a.click();
  };

  // 监听音频时间更新和播放状态变化
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };

    // 监听播放和暂停事件，确保状态同步（包括外部暂停）
    const handlePlay = () => {
      setPlaying(true);
    };

    const handlePause = () => {
      setPlaying(false);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [url]);

  // 外部“统一时间轴”同步：当自己不在播放时，让进度条跟随全局时间（并将音频指针同步到该位置，便于随时对齐播放）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) return; // 正在播放时以自身为准，避免互相覆盖
    if (typeof syncedTime !== "number" || !isFinite(syncedTime)) return;
    if (!duration || duration <= 0) return;

    const clampedTime = Math.max(0, Math.min(syncedTime, duration));
    // 避免高频 setState 造成抖动
    if (Math.abs(clampedTime - currentTime) < 0.03) return;

    audio.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  }, [syncedTime, playing, duration, currentTime]);

  // 使用 ref 保存回调，避免依赖变化导致无限循环
  const onPlaybackStateChangeRef = useRef(onPlaybackStateChange);
  useEffect(() => {
    onPlaybackStateChangeRef.current = onPlaybackStateChange;
  }, [onPlaybackStateChange]);

  // 将播放状态传递给父组件
  useEffect(() => {
    if (onPlaybackStateChangeRef.current) {
      onPlaybackStateChangeRef.current({
        currentTime,
        duration,
        playing,
        audioRef: audioRef.current,
        seek: (time) => {
          const audio = audioRef.current;
          if (audio && duration) {
            const clampedTime = Math.max(0, Math.min(time, duration));
            audio.currentTime = clampedTime;
            setCurrentTime(clampedTime);
          }
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, duration, playing]);

  // 计算进度百分比
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // 处理进度条拖拽
  const handleProgressChange = (e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const newTime = (e.target.value / 100) * duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
    if (typeof onUserSeek === "function") {
      onUserSeek(newTime);
    }
  };

  // 格式化时间为 MM:SS
  const formatTime = (seconds) => {
    if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className="flex items-center gap-3 rounded-lg bg-slate-800 border border-slate-700 p-3 shadow-md min-w-0"
      onClick={onSelect}
    >
      {url ? (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onEnded={() => setPlaying(false)}
          onError={(e) => {
            const audio = e.target;
            console.error(`音频加载失败 (${name}):`, {
              error: e,
              errorCode: audio?.error?.code,
              errorMessage: audio?.error?.message,
              url,
              fileType: file?.type,
              fileName: file?.name,
              fileSize: file?.size,
              isFile: file instanceof File,
            });
            setPlaying(false);
            // 不阻塞 UI，仅记录错误
          }}
          onLoadedMetadata={() => {
            console.log(`[StemPlayer] 音频元数据加载成功: ${name}`, {
              duration: audioRef.current?.duration,
              url,
            });
          }}
          onCanPlay={() => {
            console.log(`[StemPlayer] 音频可以播放: ${name}`, {
              url,
              readyState: audioRef.current?.readyState,
            });
          }}
        />
      ) : (
        <div className="hidden" data-debug="no-url">
          {/* 调试信息：没有有效的 URL */}
        </div>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        disabled={!url}
        className={`p-2 rounded-full ${colors.button} text-white transition flex-shrink-0 ${!url ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <input
        type="range"
        min="0"
        max="100"
        value={progress}
        onChange={handleProgressChange}
        onClick={(e) => e.stopPropagation()}
        className={`flex-1 min-w-0 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer ${colors.accent}`}
      />
      <span className="text-xs text-slate-400 flex-shrink-0">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          download();
        }}
        className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 transition flex-shrink-0"
      >
        <Download size={16} />
      </button>
    </div>
  );
}

export { createSilenceWav };
