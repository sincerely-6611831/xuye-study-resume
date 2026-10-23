import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { api } from "../api/client";
import {
  normalizeAppearance,
  appearanceAttributes,
  createAppearanceCoordinator,
} from "./appearance.mjs";
import type { Appearance, AppSettings } from "./types";

function cached(userId?: string): Appearance {
  try {
    return normalizeAppearance(
      JSON.parse(
        localStorage.getItem("study-appearance:" + (userId || "guest")) || "{}",
      ),
    ) as Appearance;
  } catch {
    return normalizeAppearance() as Appearance;
  }
}

export function useAppearance(userId?: string) {
  const [appearance, setAppearance] = useState<Appearance>(() =>
    cached(userId),
  );
  const coordinator = useMemo(
    () =>
      createAppearanceCoordinator((valid: Appearance) => {
        setAppearance(valid);
        try {
          localStorage.setItem(
            "study-appearance:" + (userId || "guest"),
            JSON.stringify(valid),
          );
        } catch {
          /* 仍可在本次打开期间使用。 */
        }
      }),
    [userId],
  );
  const changeAppearance = useCallback(
    (next: Appearance) => coordinator.change(next),
    [coordinator],
  );
  useEffect(() => {
    coordinator.change(cached(userId));
    if (userId)
      coordinator
        .load(async () => (await api<AppSettings>("/settings")).appearance)
        .catch(() => {});
    return () => {
      coordinator.invalidate();
    };
  }, [userId, coordinator]);
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const attrs = appearanceAttributes(appearance, media.matches);
      const root = document.documentElement;
      root.dataset.theme = attrs.theme;
      root.dataset.accent = attrs.accent;
      root.dataset.density = attrs.density;
      root.style.setProperty("--font-scale", attrs.fontScale || "1");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);
  return { appearance, changeAppearance };
}
