import { useMemo, useState } from 'react';
import type * as echarts from 'echarts';
import type { MetricPoint, PreemptionEvent, TimeRange } from '../types';
import { formatTimeClock } from '../utils/format';
import { EChartBox } from './EChartBox';
import { InfoTip } from './InfoTip';

interface MainPulseChartProps {
  points: MetricPoint[];
  preemptions: PreemptionEvent[];
  range: TimeRange;
}

interface SeriesVisibility {
  gen: boolean;
  prompt: boolean;
  kv: boolean;
  preemptions: boolean;
}

export function MainPulseChart({ points, preemptions, range }: MainPulseChartProps) {
  const withSec = range === '1m' || range === '5m' || range === '15m';
  const [visible, setVisible] = useState<SeriesVisibility>({
    gen: true,
    prompt: true,
    kv: true,
    preemptions: true,
  });

  const toggleSeries = (key: keyof SeriesVisibility) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const option = useMemo<echarts.EChartsOption>(() => {
    const genSeries = points.map((p) => [p.ts, p.genTokPerSec]);
    const promptSeries = points.map((p) => [p.ts, p.promptTokPerSec]);
    const kvSeries = points.map((p) => [p.ts, p.kvCachePct]);

    const minTs = points.length > 0 ? points[0].ts : 0;
    const maxTs = points.length > 0 ? points[points.length - 1].ts : 0;

    const visiblePreemptions = visible.preemptions
      ? preemptions.filter((ev) => ev.ts >= minTs && ev.ts <= maxTs + 1000)
      : [];
    const preemptMap = new Map<number, PreemptionEvent[]>();
    for (const ev of visiblePreemptions) {
      const arr = preemptMap.get(ev.ts) ?? [];
      arr.push(ev);
      preemptMap.set(ev.ts, arr);
    }

    const markLineData = Array.from(preemptMap.entries()).map(([ts, evs]) => {
      const totalDelta = evs.reduce((acc, e) => acc + e.delta, 0);
      return {
        xAxis: ts,
        name: `抢占 +${totalDelta}`,
        label: {
          show: true,
          formatter: `+${Math.round(totalDelta)}`,
          color: '#FFFFFF',
          fontSize: 10,
          fontWeight: 600,
          backgroundColor: 'rgba(255, 69, 58, 0.85)',
          padding: [2, 6],
          borderRadius: 6,
        },
        lineStyle: {
          color: 'rgba(255, 69, 58, 0.78)',
          width: 1.5,
          type: 'dashed' as const,
        },
      };
    });

    const showThroughputAxis = visible.gen || visible.prompt;
    const seriesList: echarts.SeriesOption[] = [];
    let attachedPreemptions = false;

    if (visible.gen) {
      seriesList.push({
        name: '生成吞吐',
        type: 'line',
        yAxisIndex: 0,
        data: genSeries,
        showSymbol: false,
        smooth: 0.35,
        lineStyle: { width: 2.2, color: '#30D158' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(48, 209, 88, 0.22)' },
              { offset: 1, color: 'rgba(48, 209, 88, 0.0)' },
            ],
          },
        },
        ...(visible.preemptions && !attachedPreemptions
          ? {
              markLine: {
                symbol: ['none', 'none'],
                silent: false,
                data: markLineData,
              },
            }
          : {}),
      });
      attachedPreemptions = true;
    }

    if (visible.prompt) {
      seriesList.push({
        name: '提示词吞吐',
        type: 'line',
        yAxisIndex: 0,
        data: promptSeries,
        showSymbol: false,
        smooth: 0.35,
        lineStyle: { width: 2, color: '#0A84FF' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(10, 132, 255, 0.16)' },
              { offset: 1, color: 'rgba(10, 132, 255, 0.0)' },
            ],
          },
        },
        ...(visible.preemptions && !attachedPreemptions
          ? {
              markLine: {
                symbol: ['none', 'none'],
                silent: false,
                data: markLineData,
              },
            }
          : {}),
      });
      attachedPreemptions = true;
    }

    if (visible.kv) {
      const kvMarkLines: Array<Record<string, unknown>> = [
        { yAxis: 70, lineStyle: { color: 'rgba(255, 159, 10, 0.22)', type: 'dotted', width: 1 }, label: { show: false } },
        { yAxis: 85, lineStyle: { color: 'rgba(255, 69, 58, 0.32)', type: 'dotted', width: 1 }, label: { show: false } },
      ];
      if (visible.preemptions && !attachedPreemptions) {
        kvMarkLines.push(...markLineData);
        attachedPreemptions = true;
      }

      seriesList.push({
        name: 'KV 使用率',
        type: 'line',
        yAxisIndex: 1,
        data: kvSeries,
        showSymbol: false,
        smooth: 0.35,
        lineStyle: { width: 2, color: '#FF9F0A', type: 'dashed' },
        markLine: {
          symbol: ['none', 'none'],
          silent: false,
          data: kvMarkLines as never,
        },
      });
    }

    // 若三条曲线全部关闭但保留抢占标记，用透明锚点保留时间轴与红线标记
    if (!attachedPreemptions && points.length > 0) {
      seriesList.push({
        name: '时间轴锚点',
        type: 'line',
        yAxisIndex: 1,
        data: points.map((p) => [p.ts, 0]),
        showSymbol: false,
        silent: true,
        lineStyle: { width: 0, opacity: 0 },
        tooltip: { show: false },
        ...(visible.preemptions
          ? {
              markLine: {
                symbol: ['none', 'none'],
                silent: false,
                data: markLineData,
              },
            }
          : {}),
      });
    }

    return {
      animation: false,
      grid: {
        left: showThroughputAxis ? 50 : 20,
        right: visible.kv ? 46 : 18,
        top: 26,
        bottom: 24,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(38, 38, 42, 0.92)',
        borderColor: 'rgba(255, 255, 255, 0.14)',
        borderWidth: 1,
        borderRadius: 12,
        padding: [10, 12],
        textStyle: { color: '#F5F5F7', fontSize: 12 },
        axisPointer: {
          type: 'line',
          lineStyle: { color: 'rgba(255, 255, 255, 0.22)', width: 1 },
        },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [];
          if (list.length === 0) return '';
          const first = list[0] as { value?: [number, number] };
          const ts = first?.value?.[0] ?? 0;
          const timeStr = formatTimeClock(ts, true);
          let html = `<div style="font-weight:600;margin-bottom:6px;color:rgba(235,235,245,0.55);font-size:11px">${timeStr}</div>`;
          for (const item of list as Array<{ seriesName: string; color: string; value: [number, number] }>) {
            if (item.seriesName === '时间轴锚点') continue;
            const unit = item.seriesName.includes('KV') ? '%' : ' tok/s';
            const val = item.value?.[1] !== undefined ? item.value[1].toFixed(1) : '--';
            html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin:2px 0">
              <span style="color:rgba(245,245,247,0.85)"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${item.color};margin-right:7px"></span>${item.seriesName}</span>
              <span style="font-variant-numeric:tabular-nums;font-weight:600;color:#F5F5F7">${val}${unit}</span>
            </div>`;
          }
          const nearEvs = visiblePreemptions.filter((e) => Math.abs(e.ts - ts) <= (withSec ? 1000 : 30000));
          if (nearEvs.length > 0) {
            const sumD = nearEvs.reduce((a, b) => a + b.delta, 0);
            html += `<div style="margin-top:7px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);color:#FF6961;font-weight:600;font-size:11px">
              抢占尖刺：+${Math.round(sumD)} 次（KV ${nearEvs[0].kvCachePct.toFixed(1)}%）
            </div>`;
          }
          return html;
        },
      },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: 'rgba(235, 235, 245, 0.38)',
          fontSize: 10,
          formatter: (val: number) => formatTimeClock(val, withSec),
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          show: showThroughputAxis,
          name: 'tok/s',
          nameTextStyle: { color: 'rgba(235, 235, 245, 0.35)', fontSize: 10, align: 'right' },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: 'rgba(235, 235, 245, 0.45)', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.055)' } },
          min: 0,
        },
        {
          type: 'value',
          show: visible.kv,
          name: 'KV %',
          nameTextStyle: { color: 'rgba(235, 235, 245, 0.35)', fontSize: 10, align: 'left' },
          min: 0,
          max: 100,
          interval: 25,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: 'rgba(235, 235, 245, 0.45)', fontSize: 10, formatter: '{value}%' },
          splitLine: { show: false },
        },
      ],
      series: seriesList,
    };
  }, [points, preemptions, withSec, visible]);

  const toggles: Array<{
    key: keyof SeriesVisibility;
    label: string;
    dotClass: string;
    isLine?: boolean;
  }> = [
    { key: 'gen', label: '生成吞吐', dotClass: 'bg-[#30D158]' },
    { key: 'prompt', label: '提示词吞吐', dotClass: 'bg-[#0A84FF]' },
    { key: 'kv', label: 'KV 使用率', dotClass: 'bg-[#FF9F0A]' },
    { key: 'preemptions', label: '抢占标记', dotClass: 'bg-[#FF453A]', isLine: true },
  ];

  return (
    <div className="apple-card flex flex-col p-4 min-h-0">
      <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-[#F5F5F7] tracking-tight">
            吞吐与 KV 压力主脉搏
          </span>
          <InfoTip
            title="吞吐量与 KV Cache 关联波形"
            formula="左轴：Token 吞吐 (tok/s) · 右轴：KV 使用率 (%)"
            description="将生成/提示词吞吐与 KV Cache 使用率叠加展示，配合 70%/85% 警戒虚线与抢占红线标记；点击右上角图例可单独显示或隐藏任意指标以聚焦细节。"
          />
          <span className="text-[11px] text-white/35 ml-1">点击图例可开关指标</span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] shrink-0 select-none" role="group" aria-label="波形指标开关">
          {toggles.map((item) => {
            const active = visible[item.key];
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleSeries(item.key)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                  active
                    ? 'bg-white/[0.07] border-white/[0.12] text-white/85 hover:bg-white/[0.12]'
                    : 'bg-transparent border-white/[0.04] text-white/30 opacity-50 hover:opacity-80'
                }`}
              >
                {item.isLine ? (
                  <span className={`w-0.5 h-2.5 rounded-full ${item.dotClass}`} />
                ) : (
                  <span className={`w-2 h-2 rounded-full ${item.dotClass}`} />
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full">
        <EChartBox option={option} />
      </div>
    </div>
  );
}
