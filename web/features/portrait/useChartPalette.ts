"use client";

import { useEffect, useState } from "react";

const defaults = { first: "#345d8e", second: "#297b67", third: "#916e39", fourth: "#bb5363", text: "#6b7488", grid: "#dde2ea", surface: "#ffffff", foreground: "#1e2430" };

export function useChartPalette() {
  const [palette, setPalette] = useState(defaults);
  useEffect(() => {
    const update = () => {
      const style = getComputedStyle(document.documentElement);
      const value = (name: string) => style.getPropertyValue(name).trim();
      setPalette({ first: value("--chart-1"), second: value("--chart-2"), third: value("--chart-3"), fourth: value("--chart-4"), text: value("--muted-foreground"), grid: value("--border"), surface: value("--popover"), foreground: value("--popover-foreground") });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return palette;
}
