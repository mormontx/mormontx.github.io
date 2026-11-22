import type { ComponentType } from 'react';
import type { BuildSpec } from './kit';
import { FrameModel, frameSpec } from './FrameBuild';
import { ScaffoldModel, scaffoldSpec } from './ScaffoldBuild';
import { BridgeModel, bridgeSpec } from './BridgeBuild';

/** One buildable structure: its rules and the model that draws them. */
export interface BuildEntry {
  // Each entry pairs a spec and a model over the same (private) state type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spec: BuildSpec<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Model: ComponentType<{ state: any }>;
}

export const BUILDS: Record<number, BuildEntry> = {
  2: { spec: frameSpec, Model: FrameModel },
  3: { spec: scaffoldSpec, Model: ScaffoldModel },
  4: { spec: bridgeSpec, Model: BridgeModel },
};
