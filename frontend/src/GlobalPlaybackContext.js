import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/**
 * 全局播放协调器：保证整个 App 同一时间只允许一个 HTMLAudioElement 处于播放状态。
 * - 任意组件请求播放时，会先暂停当前活跃的音频（如果存在且不是同一个）。
 * - 当活跃音频暂停/结束时，会自动清理 active 引用。
 */

const GlobalPlaybackContext = createContext(null);

export const useGlobalPlayback = () => {
  const ctx = useContext(GlobalPlaybackContext);
  if (!ctx) {
    throw new Error("useGlobalPlayback must be used within GlobalPlaybackProvider");
  }
  return ctx;
};

export const GlobalPlaybackProvider = ({ children }) => {
  const activeRef = useRef({ audio: null, meta: null });

  // 仅用于调试/可视化（不强依赖 UI），避免频繁 re-render
  const [activeMeta, setActiveMeta] = useState(null);

  const clearIfActive = useCallback((audio) => {
    if (!audio) return;
    if (activeRef.current.audio !== audio) return;
    activeRef.current = { audio: null, meta: null };
    setActiveMeta(null);
  }, []);

  const ensureListeners = useCallback(
    (audio) => {
      if (!audio) return;
      if (audio.__globalPlaybackListenersAttached) return;
      audio.__globalPlaybackListenersAttached = true;

      const onEnded = () => clearIfActive(audio);
      const onPause = () => {
        // 如果被别的播放器打断暂停，或用户手动暂停，都视为当前活跃播放结束
        clearIfActive(audio);
      };

      audio.addEventListener("ended", onEnded);
      audio.addEventListener("pause", onPause);

      // 简易清理函数（可选）
      audio.__globalPlaybackDetach = () => {
        try {
          audio.removeEventListener("ended", onEnded);
          audio.removeEventListener("pause", onPause);
        } catch {}
        try {
          delete audio.__globalPlaybackListenersAttached;
        } catch {}
        try {
          delete audio.__globalPlaybackDetach;
        } catch {}
      };
    },
    [clearIfActive],
  );

  const requestPlay = useCallback(
    (audio, meta = null) => {
      if (!audio) return;
      ensureListeners(audio);

      const prev = activeRef.current.audio;
      if (prev && prev !== audio) {
        try {
          if (!prev.paused) prev.pause();
        } catch {}
      }

      activeRef.current = { audio, meta };
      setActiveMeta(meta);
    },
    [ensureListeners],
  );

  const pauseActive = useCallback(() => {
    const audio = activeRef.current.audio;
    if (!audio) return;
    try {
      if (!audio.paused) audio.pause();
    } catch {}
  }, []);

  const isActiveAudio = useCallback((audio) => {
    return !!audio && activeRef.current.audio === audio;
  }, []);

  const value = useMemo(
    () => ({
      requestPlay,
      pauseActive,
      isActiveAudio,
      activeMeta,
    }),
    [requestPlay, pauseActive, isActiveAudio, activeMeta],
  );

  return (
    <GlobalPlaybackContext.Provider value={value}>
      {children}
    </GlobalPlaybackContext.Provider>
  );
};

