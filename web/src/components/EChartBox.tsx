import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface EChartBoxProps {
  option: echarts.EChartsOption;
  className?: string;
}

export function EChartBox({ option, className = '' }: EChartBoxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        chart.resize();
      });
    });
    ro.observe(el);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  return <div ref={containerRef} className={`w-full h-full min-h-0 min-w-0 ${className}`} />;
}
