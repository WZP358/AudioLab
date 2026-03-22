import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

// Theme: "system" | "light" | "dark"
const ThemeContext = createContext({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
});

const STORAGE_KEY = "audiolab-theme";

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") return saved;
    } catch {}
    return "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState("light");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (target) => {
      if (target === "dark") {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
      setResolvedTheme(target);
    };

    if (theme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mql.matches ? "dark" : "light");
      const listener = (e) => apply(e.matches ? "dark" : "light");
      try {
        mql.addEventListener("change", listener);
        return () => mql.removeEventListener("change", listener);
      } catch {
        // Safari fallback
        mql.addListener(listener);
        return () => mql.removeListener(listener);
      }
    } else {
      apply(theme);
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

