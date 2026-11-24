export type ThemePreset = "obsidian" | "clay" | "amber" | "nordic";
export type MarketColorMode = "us" | "cn";

export const THEME_PRESETS: Array<{
  id: ThemePreset;
  label: string;
  dark: boolean;
  swatch: [string, string, string];
}> = [
  { id: "obsidian", label: "曜石深色", dark: true, swatch: ["#131517", "#1d2024", "#4ec892"] },
  { id: "clay", label: "暖纸浅色", dark: false, swatch: ["#f7f5ef", "#ffffff", "#355d47"] },
  { id: "amber", label: "琥珀终端", dark: true, swatch: ["#141210", "#1f1c18", "#e8a845"] },
  { id: "nordic", label: "北欧冰白", dark: false, swatch: ["#f5f7fa", "#ffffff", "#2e63c9"] },
];

export function applyTheme(preset: ThemePreset, colorMode: MarketColorMode) {
  const root = document.documentElement;
  root.dataset.preset = preset;
  root.dataset.colors = colorMode;
  const isDark = THEME_PRESETS.find((t) => t.id === preset)?.dark ?? true;
  root.classList.toggle("dark", isDark);
  localStorage.setItem("northstar.preset", preset);
  localStorage.setItem("northstar.colors", colorMode);
}
