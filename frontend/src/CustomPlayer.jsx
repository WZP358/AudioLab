import { useRef, useState, useEffect } from "react";
import { Play, Pause } from "lucide-react";

export default function CustomPlayer({ src, onPlaybackStateChange, onUserSeek, syncedTime }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const el = audioRef.current;
    if (el.paused) {
      el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  // 格式化时间为 MM:SS
  const formatTime = (seconds) => {
    if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
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
  }, [src]);

  // 外部“统一时间轴”同步：当自己不在播放时，让进度条跟随全局时间（并将音频指针同步到该位置，便于随时对齐播放）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) return; // 正在播放时以自身为准，避免互相覆盖
    if (typeof syncedTime !== "number" || !isFinite(syncedTime)) return;
    if (!duration || duration <= 0) return;

    const clampedTime = Math.max(0, Math.min(syncedTime, duration));

    // 避免高频 setState 造成抖动：和 audio 实际时间比较，而不是和自身状态互相触发
    const currentAudioTime = audio.currentTime || 0;
    if (Math.abs(clampedTime - currentAudioTime) < 0.03) return;

    // 只更新 audio 指针，currentTime 交给 timeupdate 事件去同步，避免依赖 currentTime 造成循环
    audio.currentTime = clampedTime;
  }, [syncedTime, playing, duration]);

  // 将播放状态传递给父组件
  useEffect(() => {
    if (onPlaybackStateChange) {
      onPlaybackStateChange({
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

  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-800 border border-slate-700 p-3 shadow-md">
      {/* 隐藏原生标签，只负责解码 */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onEnded={() => setPlaying(false)}
        onError={(e) => {
          console.error("音频加载失败:", e);
          // 不阻塞 UI，仅记录错误
        }}
      />

      {/* 播放/暂停按钮 */}
      <button
        onClick={toggle}
        className="p-2 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white transition"
      >
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>

      {/* 进度条 */}
      <input
        type="range"
        min="0"
        max="100"
        value={progress}
        onChange={handleProgressChange}
        className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
      />

      {/* 当前时间 / 总时间 */}
      <span className="text-xs text-slate-400">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
}
