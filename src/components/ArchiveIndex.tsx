import { useState } from 'react';
import CanvasHost from './three/CanvasHost';
import StructureModel from './three/structures/StructureModels';
import SceneFallback from './three/SceneFallback';
import { pad } from '../lib/format';

export interface ArchiveStructure {
  id: string;
  number: number;
  title: string;
  typology: string;
  scale: string;
  medium: string;
  year: number;
}


interface ArchiveIndexProps {
  structures: ArchiveStructure[];
}

/**
 * Interactive archive index: a typographic list on the left and a sticky
 * live-model plate on the right (below the list on mobile). Hover/focus is a
 * progressive enhancement only — every row is a normal anchor, so keyboard
 * and no-JS navigation still work. The plate's own prev/next and dash controls
 * let touch screens, which have no hover, browse the models too.
 */
export default function ArchiveIndex({ structures }: ArchiveIndexProps) {
  const [current, setCurrent] = useState(structures[0]?.number ?? 1);
  const [hovered, setHovered] = useState<number | null>(null);

  const activeIndex = Math.max(
    0,
    structures.findIndex((s) => s.number === current),
  );
  const active = structures[activeIndex];
  const total = structures.length;

  // Touch screens have no hover, so the plate also has its own controls.
  const step = (delta: number) =>
    setCurrent(structures[(activeIndex + delta + total) % total].number);

  return (
    <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
      {/* Typographic list — first in reading order on every screen size. */}
      <div>
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

      {/* Live model plate — below the list on mobile, sticky on desktop. */}
      <div>
        <div className="lg:sticky lg:top-[120px]">
          <div className="overflow-hidden border border-hairline bg-paper">
            <div className="relative h-[300px] sm:h-[380px] lg:h-[62vh] lg:min-h-[360px]">
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
              <a
                href={`/structures/${active.id}/`}
                className="meta block text-accent underline decoration-transparent underline-offset-4 transition-colors hover:decoration-accent"
              >
                № {pad(active.number)} — {active.title.toUpperCase()} ·{' '}
                {active.typology.toUpperCase()} · {active.year}
              </a>

              <div className="mt-2 flex items-center justify-between">
                <div className="-ml-2 flex items-center">
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous model"
                    className="meta flex h-8 w-8 items-center justify-center transition-colors hover:text-accent"
                  >
                    ←
                  </button>
                  <p className="meta tabular-nums">
                    {pad(active.number)} / {pad(total)}
                  </p>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next model"
                    className="meta flex h-8 w-8 items-center justify-center transition-colors hover:text-accent"
                  >
                    →
                  </button>
                </div>
                <div className="flex gap-1.5">
                  {structures.map((s) => {
                    const isActive = s.number === active.number;
                    return (
                      <button
                        key={s.number}
                        type="button"
                        onClick={() => setCurrent(s.number)}
                        aria-label={`Show model ${pad(s.number)}, ${s.title}`}
                        aria-pressed={isActive}
                        className="group/dot flex h-8 items-center"
                      >
                        <span
                          className={`block h-px w-9 transition-colors ${
                            isActive ? 'bg-accent' : 'bg-hairline group-hover/dot:bg-mute'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
