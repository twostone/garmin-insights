<script lang="ts">
  import "maplibre-gl/dist/maplibre-gl.css";
  import { onMount } from "svelte";
  import { LngLatBounds, Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";

  // OpenFreeMap tiles (no API key). The CSP allows exactly this host plus blob: for MapLibre's worker.
  const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
  let { points, label }: { points: [number, number][]; label: string } = $props(); // [lon, lat]
  let el: HTMLDivElement;

  onMount(() => {
    // Served by the app itself (see vite.config.ts), relative to <base href> so it also works under the ingress prefix.
    setWorkerUrl(new URL("maplibre/maplibre-gl-worker.mjs", document.baseURI).href);
    const map = new MapLibreMap({ container: el, style: STYLE_URL, attributionControl: { compact: true } });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } } });
      map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#e8590c", "line-width": 4 } });
      const bounds = points.reduce((b, p) => b.extend(p), new LngLatBounds(points[0], points[0]));
      map.fitBounds(bounds, { padding: 32, animate: false, maxZoom: 16 });
    });
    return () => map.remove();
  });
</script>

<div bind:this={el} class="map" role="img" aria-label={label}></div>
