/**
 * The three steps every statistics chart is drawn in, most to least. The parts a chart
 * splits a count into are ordered — got further, got a reply, got nothing — so the steps
 * are a ramp of the accent rather than three hues standing for three things, and `rest` is
 * always the part where nothing further happened.
 */
export type ChartTone = "strong" | "mid" | "rest";

export interface ChartKeyItem {
  label: string;
  /** A filled swatch in one of the tones, or the thin line a chart marks a mean with. */
  mark: ChartTone | "line";
}

interface ChartKeyProps {
  /** What the chart's lengths and figures are, said once instead of on every row. */
  caption: string;
  items: ChartKeyItem[];
}

export function ChartKey({ caption, items }: ChartKeyProps) {
  return (
    <div className="chart-key">
      <span className="chart-key__caption">{caption}</span>
      <ul className="chart-key__legend">
        {items.map((item) => (
          <li key={item.label}>
            <span className={`chart-key__swatch chart-key__swatch--${item.mark}`} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
