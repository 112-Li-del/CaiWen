
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { apiUrl, apiFetch } from "@/lib/api";

const ReactECharts = dynamic(
  () => import("echarts-for-react"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-slate-500">
        正在初始化雷达图……
      </div>
    ),
  }
);

type Dimension = "student" | "class";

type RadarItem = {
  label: string;
  raw: number | string;
  unit?: string;
  maximum?: number;
};

type PortraitData = {
  dimension?: Dimension;
  title?: string;
  student_id: number | null;
  class_id: number | null;
  radar?: RadarItem[];
  [key: string]: unknown;
};

type Props = {
  dimension: Dimension;
  id: number;
};

export default function PortraitDetailClient({
  dimension,
  id,
}: Props) {
  const [data, setData] = useState<PortraitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError("");
      setData(null);

      try {
        const catalogResponse = await apiFetch(
          apiUrl("/api/v1/portrait/catalog"),
          { cache: "no-store" }
        );

        const catalogBody = await catalogResponse.json();

        if (!catalogResponse.ok) {
          throw new Error(
            catalogBody.detail || "获取画像目录失败"
          );
        }

        const semesters =
          catalogBody.semesters ??
          catalogBody.data?.semesters ??
          [];

        const semesterId =
          semesters[0]?.id ??
          semesters[0]?.semester_id ??
          catalogBody.semester_id ??
          catalogBody.data?.semester_id;

        if (semesterId == null) {
          throw new Error(
            "没有获取到学期 ID，请检查画像目录接口返回的数据"
          );
        }

        const params = new URLSearchParams({
          semester_id: String(semesterId),
          dimension,
        });

        if (dimension === "student") {
          params.set("student_id", String(id));
        } else {
          params.set("class_id", String(id));
        }

        const response = await apiFetch(
          apiUrl(
            `/api/v1/portrait/overview?${params.toString()}`
          ),
          { cache: "no-store" }
        );

        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.detail || "获取画像详情失败"
          );
        }

        const result = (body.data ?? body) as PortraitData;

        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "加载画像数据失败，请稍后重试"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [dimension, id]);

  if (loading) {
    return (
      <div className="flex h-[calc(100dvh-180px)] min-h-[400px] items-center justify-center rounded-xl border border-[var(--border)] text-sm text-[var(--muted-foreground)]">
        正在加载画像详情……
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--border)] p-6">
        <h2 className="font-semibold text-[var(--foreground)]">
          画像数据加载失败
        </h2>
        <p className="mt-3 break-words text-sm text-red-500">
          {error}
        </p>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          请检查后端服务、接口地址、当前学期以及对应的学生或班级 ID。
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        暂无画像数据。
      </p>
    );
  }

  const radar: RadarItem[] = Array.isArray(data.radar)
    ? data.radar.filter(
        (item): item is RadarItem =>
          Boolean(
            item &&
              typeof item.label === "string" &&
              item.label.trim() !== ""
          )
      )
    : [];

  const radarValues = radar.map((item) => {
    const value = Number(item.raw);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  });

  const radarIndicators = radar.map((item, index) => {
    const value = radarValues[index];
    const configuredMaximum = Number(item.maximum);

    const maximum =
      Number.isFinite(configuredMaximum) &&
      configuredMaximum > value
        ? configuredMaximum
        : Math.max(value * 1.2, 100);

    return {
      name: item.label,
      max: maximum,
    };
  });

  const radarOption = {
    animation: true,
    tooltip: {
      trigger: "item",
    },
    radar: {
      indicator: radarIndicators,
      radius: "62%",
      center: ["50%", "50%"],
      axisName: {
        color: "#64748b",
        fontSize: 12,
      },
      axisLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.55)",
        },
      },
      splitLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.4)",
        },
      },
      splitArea: {
        areaStyle: {
          color: [
            "rgba(59, 130, 246, 0.03)",
            "rgba(59, 130, 246, 0.08)",
          ],
        },
      },
    },
    series: [
      {
        name: dimension === "student" ? "学生画像" : "班级画像",
        type: "radar",
        data: [
          {
            name: dimension === "student" ? "个人指标" : "班级指标",
            value: radarValues,
            symbol: "circle",
            symbolSize: 6,
            lineStyle: {
              width: 3,
              color: "#3b82f6",
            },
            itemStyle: {
              color: "#3b82f6",
            },
            areaStyle: {
              color: "rgba(59, 130, 246, 0.25)",
            },
          },
        ],
      },
    ],
  };

  return (
    <div className="h-[calc(100dvh-180px)] min-h-[400px] overflow-hidden">
      <div className="grid h-full min-h-0 grid-cols-[minmax(260px,35%)_minmax(0,65%)] gap-4">
        {/* 左侧：指标详情 */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] p-4">
          <h2 className="shrink-0 text-lg font-semibold text-[var(--foreground)]">
            指标详情
          </h2>

          {radar.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-[var(--muted-foreground)]">
              暂无指标详情，请检查接口返回的 radar 字段。
            </div>
          ) : (
            <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {radar.map((item, index) => (
                <div
                  key={`${item.label}-${index}`}
                  className="rounded-lg border border-[var(--border)] p-3"
                >
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {item.label}
                  </p>

                  <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                    {item.raw}
                    {item.unit ? (
                      <span className="ml-1 text-sm font-normal">
                        {item.unit}
                      </span>
                    ) : null}
                  </p>

                  {item.maximum != null && (
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      指标上限：{item.maximum}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 右侧：雷达图 */}
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] p-4">
          <h2 className="shrink-0 text-lg font-semibold text-[var(--foreground)]">
            {dimension === "student" ? "学生综合画像" : "班级综合画像"}
          </h2>

          {radar.length < 3 ? (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-[var(--muted-foreground)]">
              {radar.length === 0
                ? "暂无雷达图指标数据。"
                : "雷达图至少需要 3 个有效指标，请检查接口返回的数据。"}
            </div>
          ) : (
            <div className="mt-2 min-h-0 w-full flex-1">
              <ReactECharts
                option={radarOption}
                notMerge={true}
                lazyUpdate={false}
                opts={{ renderer: "canvas" }}
                style={{
                  height: "100%",
                  width: "100%",
                }}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
