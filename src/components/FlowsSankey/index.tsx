import classnames from 'classnames';
import React from 'react';

import { Flow } from '~/domain/flows';
import { SankeyLink, SankeyNode, sankeyOf } from '~/domain/flows/sankey';

import css from './styles.scss';

export interface Props {
  flows: Flow[];
  namespace: string | null;
  // code mode text of the filter to add, `!` first to exclude
  onFilter?: (filter: string) => void;
}

const width = 1200;
const nodeWidth = 10;
const gap = 10;
const xs = [220, 595, 970];

interface Placed extends SankeyNode {
  y: number;
  h: number;
}

// shortcut: a fixed three-column layout, no crossing reduction; enough for
// the busiest dozen nodes a column keeps.
const layout = (nodes: SankeyNode[], links: SankeyLink[]) => {
  const columns = [0, 1, 2].map(c =>
    nodes.filter(n => n.column === c).sort((a, b) => b.count - a.count),
  );
  const most = Math.max(...columns.map(c => c.length));
  const height = Math.max(360, most * 34);
  const total = Math.max(...columns.map(c => c.reduce((s, n) => s + n.count, 0)), 1);
  const k = (height - gap * (most - 1)) / total;

  // A small node still gets room for its label; its bands stay to scale.
  const placed = new Map<string, Placed>();
  let bottom = height;
  columns.forEach(col => {
    let y = 0;
    col.forEach(n => {
      const h = Math.max(n.count * k, 16);
      placed.set(n.id, { ...n, y, h });
      y += h + gap;
    });
    bottom = Math.max(bottom, y - gap);
  });

  // Each node stacks its bands in the order of the nodes at their other end.
  const out = new Map<string, number>();
  const into = new Map<string, number>();
  const order = (l: SankeyLink, end: 'from' | 'to') => placed.get(l[end])!.y;
  const bands = [...links]
    .sort((a, b) => order(a, 'to') - order(b, 'to') || a.verdict.localeCompare(b.verdict))
    .map(l => {
      const w = Math.max(l.count * k, 1);
      const sy = placed.get(l.from)!.y + (out.get(l.from) ?? 0);
      out.set(l.from, (out.get(l.from) ?? 0) + w);
      return { l, w, sy };
    })
    .sort((a, b) => order(a.l, 'from') - order(b.l, 'from'))
    .map(b => {
      const ty = placed.get(b.l.to)!.y + (into.get(b.l.to) ?? 0);
      into.set(b.l.to, (into.get(b.l.to) ?? 0) + b.w);
      return { ...b, ty };
    });

  return { placed: [...placed.values()], bands, height: bottom };
};

export const FlowsSankey = (props: Props) => {
  const { nodes, links } = sankeyOf(props.flows, props.namespace);
  if (nodes.length === 0) return <div className={css.empty}>No flows to show yet.</div>;

  const { placed, bands, height } = layout(nodes, links);
  const x = (n: Placed) => xs[n.column];
  const byId = new Map(placed.map(n => [n.id, n]));

  const click = (n: Placed) => (e: React.MouseEvent) => {
    if (n.filter) props.onFilter?.(`${e.altKey ? '!' : ''}${n.filter}`);
  };

  return (
    <div className={css.wrapper}>
      <div className={css.header}>
        <span>Source</span>
        <span>Port</span>
        <span>Destination</span>
      </div>
      <svg
        className={css.sankey}
        viewBox={`-10 -10 ${width + 20} ${height + 20}`}
        role="img"
        aria-label="Flows from source through port to destination"
      >
        {bands.map(({ l, w, sy, ty }) => {
          const x0 = x(byId.get(l.from)!) + nodeWidth;
          const x1 = x(byId.get(l.to)!);
          const y0 = sy + w / 2;
          const y1 = ty + w / 2;
          const mid = (x0 + x1) / 2;
          // Both ends; a band cannot be left out, as each `!` filter would
          // leave out all of its end.
          const filter = [byId.get(l.from)!.filter, byId.get(l.to)!.filter]
            .filter(Boolean)
            .join(' ');
          return (
            <path
              key={`${l.from}>${l.to}>${l.verdict}`}
              className={classnames(css[l.verdict], { [css.band]: filter })}
              d={`M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1}`}
              strokeWidth={w}
              data-sankey-band={`${byId.get(l.from)!.name}>${byId.get(l.to)!.name}`}
              onClick={() => filter && props.onFilter?.(filter)}
            >
              <title>
                {`${byId.get(l.from)!.name} → ${byId.get(l.to)!.name}: ${l.count} ${l.verdict}`}
                {filter && `. Click to filter by ${filter}.`}
              </title>
            </path>
          );
        })}
        {placed.map(n => (
          <g
            key={n.id}
            className={n.filter ? css.node : css.inert}
            onClick={click(n)}
            data-sankey-node={n.name}
          >
            <rect x={x(n)} y={n.y} width={nodeWidth} height={n.h} rx={2} />
            <text
              x={n.column === 0 ? x(n) - 8 : x(n) + nodeWidth + 8}
              y={n.y + n.h / 2}
              textAnchor={n.column === 0 ? 'end' : 'start'}
              dominantBaseline="middle"
            >
              {n.name}
              <tspan className={css.count}> {n.count}</tspan>
            </text>
            <title>
              {n.filter
                ? `${n.name}: ${n.count} flows. Click to filter for it, Alt-click to filter it out.`
                : `${n.name}: ${n.count} flows`}
            </title>
          </g>
        ))}
      </svg>
      <div className={css.legend}>
        <span className={css.keyForwarded}>forwarded</span>
        <span className={css.keyDropped}>dropped</span>
        <span className={css.keyOther}>other verdicts</span>
        <span>Requests only. Click a name or band to filter; Alt-click a name to exclude it.</span>
      </div>
    </div>
  );
};
