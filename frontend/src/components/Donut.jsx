/**
 * Donut chart, hand-rolled in SVG.
 *
 * A charting library for a single ring would outweigh the rest of the app, and
 * the maths here is one line: a circle's `stroke-dasharray` can be told to paint
 * only part of its circumference, and `stroke-dashoffset` decides where that
 * part starts. Stack four of those and you have the ring.
 *
 * Colours are passed in as CSS custom properties rather than hex, so the chart
 * follows the design tokens -- change `--near-500` once and the amber segment,
 * the amber badge and the amber stat tile all move together.
 *
 * `total` is passed in rather than summed from the segments: the caller may be
 * charting a subset (active items) while the number in the middle means
 * something else (items in the kitchen). Falling back to the sum keeps the ring
 * honest when they are the same thing.
 */

const SIZE = 168;
const STROKE = 20;

export default function Donut({ segments, total, label = 'items' }) {
  const data = segments.filter((s) => s.value > 0);
  const sum = data.reduce((acc, s) => acc + s.value, 0);
  const shown = total ?? sum;

  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  // Running start position for each arc, in user units along the circumference.
  let offset = 0;

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {/* The track shows through wherever there is no data, so an empty or
              partly-filled ring still reads as a ring. */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={radius}
            fill="none"
            stroke="var(--line-soft)"
            strokeWidth={STROKE}
          />

          {sum > 0 &&
            data.map((s) => {
              const length = (s.value / sum) * circumference;
              const dash = `${length} ${circumference - length}`;
              const start = -offset;
              offset += length;

              return (
                <circle
                  key={s.key}
                  className="donut-seg"
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={radius}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={STROKE}
                  strokeDasharray={dash}
                  strokeDashoffset={start}
                  // Rounded caps on a single full-circle segment would overlap
                  // themselves and show a seam, so they are only used when the
                  // ring is actually divided.
                  strokeLinecap={data.length > 1 ? 'round' : 'butt'}
                />
              );
            })}
        </svg>

        <div className="donut-hole">
          <div className="donut-total">{shown}</div>
          <div className="donut-total-label">{label}</div>
        </div>
      </div>

      {/* The legend is the accessible version of the chart: the SVG is hidden
          from assistive tech and these rows carry the same numbers as text. */}
      <div className="donut-legend">
        {segments.map((s) => (
          <div key={s.key} className="legend-row">
            <span className="legend-swatch" style={{ background: s.color }} aria-hidden="true" />
            <span className="legend-label">{s.label}</span>
            <span className="legend-value">{s.value}</span>
            <span className="legend-pct">
              {sum > 0 ? `${Math.round((s.value / sum) * 100)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
