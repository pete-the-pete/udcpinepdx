/**
 * Hand-rolled SVG temperature chart for one firing: the curve, pizza markers,
 * a hover tooltip, and a scrubber. Dragging the scrubber feeds the reading at
 * the playhead into a real `ChefStage`, so you can re-live the firing and watch
 * Chuck react. `mode` ("clean" | "raw") is owned by the page and shared with
 * the results list.
 */
import { useMemo, useRef, useState } from "preact/hooks";
import { ChefStage } from "@frontend/chef/ChefStage";
import { celsiusToFahrenheit } from "@frontend/temp";
import type { Firing, SeriesPoint } from "../data";

const W = 1000;
const H = 440;
const PAD = { l: 52, r: 20, t: 24, b: 38 };
const Y_MAX_F = 950; // headroom over the 882°F clean peak; the fault clamps above
const Y_TICKS = [0, 200, 400, 600, 800];
const X_TICKS_MIN = [0, 30, 60, 90, 120, 150, 180];

const c2f = (c: number) => celsiusToFahrenheit(c);

export function FiringChart({ firing, mode }: { firing: Firing; mode: "clean" | "raw" }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dur = firing.duration_s;
  const x = (s: number) => PAD.l + (s / dur) * (W - PAD.l - PAD.r);
  const y = (f: number) => PAD.t + (1 - Math.min(f, Y_MAX_F) / Y_MAX_F) * (H - PAD.t - PAD.b);

  const cleanPath = useMemo(() => buildPath(firing.series, x, y, true), [firing]);
  const rawPath = useMemo(() => buildPath(firing.series, x, y, false), [firing]);
  const fault = useMemo(() => firing.series.find((p) => p.fault), [firing]);

  // Playhead starts at the hottest clean reading so Chuck loads lively.
  const peak = useMemo(
    () => firing.series.filter((p) => !p.fault).reduce((a, b) => (b.c > a.c ? b : a)),
    [firing],
  );
  const [head, setHead] = useState<SeriesPoint>(peak);
  const [tip, setTip] = useState<{ x: number; show: boolean }>({ x: 0, show: false });

  function nearest(s: number): SeriesPoint {
    let best = firing.series[0]!;
    for (const p of firing.series) {
      if (mode === "clean" && p.fault) continue;
      if (Math.abs(p.x - s) < Math.abs(best.x - s)) best = p;
    }
    return best;
  }
  function pizzaAt(s: number) {
    return firing.pizzas.find((p) => p.end != null && s >= p.start && s <= p.end);
  }
  function onMove(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    const s = Math.max(0, Math.min(dur, ((sx - PAD.l) / (W - PAD.l - PAD.r)) * dur));
    setHead(nearest(s));
    setTip({ x: clientX - rect.left, show: true });
  }

  const headF = c2f(head.c);
  const headPizza = pizzaAt(head.x);
  const sample = { t: new Date(0).toISOString(), temp_c: head.c };

  return (
    <div class="chart-block" data-mode={mode}>
      <div class="chart-head">
        <div class="chart-chuck">
          <ChefStage latest_sample={sample} />
        </div>
        <div class="chart-readout">
          <span class="chart-readout__f">{Math.round(headF)}°F</span>
          <span class="chart-readout__ctx">
            {Math.floor(head.x / 60)}m in{headPizza ? ` · ${labelFor(headPizza)}` : ""}
          </span>
        </div>
      </div>

      <div class="chart-wrap">
        <svg
          ref={svgRef}
          class="chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Oven air temperature over the firing"
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerDown={(e) => onMove(e.clientX)}
          onPointerLeave={() => setTip((t) => ({ ...t, show: false }))}
        >
          {Y_TICKS.map((f) => (
            <g key={`y${f}`}>
              <line class="chart__grid" x1={PAD.l} x2={W - PAD.r} y1={y(f)} y2={y(f)} />
              <text class="chart__ylabel" x={PAD.l - 8} y={y(f) + 4}>{f}°</text>
            </g>
          ))}
          {X_TICKS_MIN.filter((m) => m * 60 <= dur).map((m) => (
            <text key={`x${m}`} class="chart__xlabel" x={x(m * 60)} y={H - 12}>{m}m</text>
          ))}

          {firing.pizzas
            .filter((p) => p.end != null)
            .map((p) => (
              <rect
                key={`band${p.seq}`}
                class={`chart__band chart__band--${p.kind}`}
                x={x(p.start)}
                y={PAD.t}
                width={Math.max(2, x(p.end!) - x(p.start))}
                height={H - PAD.t - PAD.b}
              />
            ))}

          <path class="chart__line" d={cleanPath} />
          <path class="chart__line chart__line--raw" d={rawPath} />

          {fault && (
            <g class="chart__fault">
              <circle class="chart__faultdot" cx={x(fault.x)} cy={y(c2f(fault.c))} r={5} />
              <text class="chart__faultlabel" x={x(fault.x)} y={y(c2f(fault.c)) - 12}>
                sensor glitch
              </text>
            </g>
          )}

          <g class="chart__scrub">
            <line class="chart__scrubline" x1={x(head.x)} x2={x(head.x)} y1={PAD.t} y2={H - PAD.b} />
            <circle class="chart__scrubdot" cx={x(head.x)} cy={y(headF)} r={5} />
          </g>
        </svg>

        <div class="chart__tip" style={{ left: `${tip.x}px`, opacity: tip.show ? 1 : 0 }}>
          <b>{Math.round(headF)}°F</b> · {Math.floor(head.x / 60)}m
          {headPizza ? <span>{labelFor(headPizza)}</span> : null}
        </div>
      </div>
    </div>
  );
}

function labelFor(p: { kind: string; name: string; no?: number | null }): string {
  if (p.kind === "pizza") return `🍕 #${p.no} ${p.name}`;
  if (p.kind === "note") return p.name;
  return "tending the fire";
}

function buildPath(
  series: SeriesPoint[],
  x: (s: number) => number,
  y: (f: number) => number,
  skipFault: boolean,
): string {
  let d = "";
  let pen = false;
  for (const p of series) {
    if (skipFault && p.fault) continue;
    const px = x(p.x).toFixed(1);
    const py = y(c2f(p.c)).toFixed(1);
    d += `${pen ? "L" : "M"}${px} ${py} `;
    pen = true;
  }
  return d.trim();
}
