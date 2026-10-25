import React from 'react';
import { Material, SELECTABLE_MATERIALS, type MaterialSpec } from './materials.ts';

export interface MaterialPaletteProps {
  /** null when another tool is active, so no swatch reads as selected. */
  value: Material | null;
  onChange: (material: Material) => void;
  /** Restrict the palette, for the cut-down hero widget. */
  only?: readonly Material[];
}

/** The four that make this a brain lab get grouped and labelled as such. */
const BRAIN_MATERIALS = new Set<Material>([
  Material.NEURO, Material.SYNAPSE, Material.DOPAMINE, Material.INHIB,
]);

function PaletteButton({ spec, active, onSelect }: {
  spec: MaterialSpec;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`powder-swatch${active ? ' is-active' : ''}`}
      style={{ '--swatch': spec.color } as React.CSSProperties}
      onClick={onSelect}
      aria-pressed={active}
      title={`${spec.name} — ${spec.blurb}`}
      data-material={spec.id}
    >
      <span className="powder-swatch-chip" aria-hidden="true" />
      <span className="powder-swatch-label">{spec.label}</span>
      {spec.hotkey ? <kbd>{spec.hotkey}</kbd> : null}
    </button>
  );
}

export function MaterialPalette({ value, onChange, only }: MaterialPaletteProps) {
  const allowed = only
    ? SELECTABLE_MATERIALS.filter((spec) => only.includes(spec.id))
    : SELECTABLE_MATERIALS;
  const physics = allowed.filter((spec) => !BRAIN_MATERIALS.has(spec.id));
  const brain = allowed.filter((spec) => BRAIN_MATERIALS.has(spec.id));

  return (
    <div className="powder-palette" data-testid="powder-palette">
      <div className="powder-palette-group">
        <span className="powder-palette-heading">Matter</span>
        <div className="powder-swatches">
          {physics.map((spec) => (
            <PaletteButton
              key={spec.id}
              spec={spec}
              active={value === spec.id}
              onSelect={() => onChange(spec.id)}
            />
          ))}
        </div>
      </div>

      {brain.length ? (
        <div className="powder-palette-group">
          <span className="powder-palette-heading powder-palette-heading-brain">Brain</span>
          <div className="powder-swatches">
            {brain.map((spec) => (
              <PaletteButton
                key={spec.id}
                spec={spec}
                active={value === spec.id}
                onSelect={() => onChange(spec.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
