import { useState } from 'react';
import CanvasHost from './three/CanvasHost';
import StructureModel from './three/structures/StructureModels';
import SceneFallback from './three/SceneFallback';

export interface ArchiveStructure {
  id: string;
  number: number;
  title: string;
  typology: string;
  scale: string;
  medium: string;
  year: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

interface ArchiveIndexProps {
  structures: ArchiveStructure[];
}

/**
 * Interactive archive index: a typographic list on the left and a sticky
 * live-model plate on the right. Hover/focus is a progressive enhancement only
 * — every row is a normal anchor, so keyboard and no-JS navigation still work.
 */
export default function ArchiveIndex({ structures }: ArchiveIndexProps) {
  const [current, setCurrent] = useState(structures[0]?.number ?? 1);
  const [hovered, setHovered] = useState<number | null>(null);

  const active = structures.find((s) => s.number === current) ?? structures[0];

  return (
    <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
      {/* Live model plate — above the list on mobile, sticky on desktop. */}
      <div className="order-1 lg:order-2">
        <div className="lg:sticky lg:top-[120px]">
          <div className="overflow-hidden border border-hairline bg-paper">
            <div className="relative h-[44vh] min-h-[360px] lg:h-[62vh]">
              <div className="panel-canvas-mask absolute inset-0">
                <CanvasHost className="h-full w-full" fallback={<SceneFallback />}>
                  {active && (
                    <StructureModel
                      key={active.number}
                      number={active.number}
                      active={hovered === active.number}
                    />
                  )}
                </CanvasHost>
              </div>
            </div>

            <div className="border-t border-hairline px-5 py-4">
              <p className="meta text-accent">
                № {pad(active.number)} — {active.title.toUpperCase()} ·{' '}
                {active.typology.toUpperCase()} · {active.year}
              </p>

              <div className="mt-3 flex items-center justify-between">
                <p className="meta">
                  {pad(active.number)} / {pad(structures.length)}
                </p>
                <div className="flex gap-1.5" aria-hidden="true">
                  {structures.map((s) => (
                    <span
                      key={s.number}
                      className={`h-px w-9 ${
                        s.number === active.number ? 'bg-accent' : 'bg-hairline'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Typographic list. */}
      <div className="order-2 lg:order-1">
        {structures.map((entry) => {
          const isHovered = hovered === entry.number;
          const isDimmed = hovered !== null && !isHovered;
          return (
            <a
              key={entry.id}
              href={`/structures/${entry.id}/`}
              onMouseEnter={() => {
                setCurrent(entry.number);
                setHovered(entry.number);
              }}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => {
                setCurrent(entry.number);
                setHovered(entry.number);
              }}
              onBlur={() => setHovered(null)}
              className={`group grid grid-cols-[2.5rem_1fr_3.75rem] items-baseline gap-4 border-t border-hairline py-6 transition-opacity ${
                isDimmed ? 'opacity-50' : ''
              }`}
            >
              <span className="font-mono text-sm text-accent">
                {pad(entry.number)}
              </span>
              <span className="min-w-0">
                <span
                  className={`block font-display text-xl leading-snug transition-colors sm:text-2xl ${
                    isHovered ? 'text-accent' : 'group-hover:text-accent'
                  }`}
                >
                  {entry.title}
                </span>
                <span className="meta mt-1 block">
                  {entry.typology} · {entry.scale} · {entry.medium}
                </span>
              </span>
              <span className="meta text-right">{entry.year}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
