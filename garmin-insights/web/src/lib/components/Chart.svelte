<script lang="ts">
  import { onMount } from "svelte";
  import { BarChart, LineChart } from "echarts/charts";
  import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
  import * as echarts from "echarts/core";
  import { CanvasRenderer } from "echarts/renderers";
  import type { EChartsCoreOption } from "echarts/core";

  // ECharts, tree-shaken to what the pages use: line and bar series on a grid, tooltip, legend, zoom and mark lines.
  echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, CanvasRenderer]);

  let { option, height = 260, label }: { option: EChartsCoreOption; height?: number; label: string } = $props();
  let el: HTMLDivElement;
  let chart: echarts.ECharts | undefined;
  let dark = $state(false);

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Axis and grid colours follow the page's theme; series colours are set by the pages through CSS variables.
  function themed(o: EChartsCoreOption): EChartsCoreOption {
    const text = css("--muted");
    const line = css("--border");
    return {
      textStyle: { color: text },
      animation: false,
      grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
      ...o,
      legend: o.legend ? { textStyle: { color: text }, top: 0, ...(o.legend as object) } : undefined,
      tooltip: { trigger: "axis", confine: true, backgroundColor: css("--surface"), borderColor: line, textStyle: { color: css("--text") }, ...(o.tooltip as object) },
    };
  }

  onMount(() => {
    chart = echarts.init(el);
    const resize = new ResizeObserver(() => chart?.resize());
    resize.observe(el);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => (dark = scheme.matches);
    scheme.addEventListener("change", onScheme);
    return () => {
      resize.disconnect();
      scheme.removeEventListener("change", onScheme);
      chart?.dispose();
    };
  });

  $effect(() => {
    void dark; // re-render with the new colours when the theme flips
    chart?.setOption(themed(option), true);
  });
</script>

<div bind:this={el} class="chart" style:height="{height}px" role="img" aria-label={label}></div>
