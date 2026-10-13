import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { BRIDGE_KEY, type XrBridge } from './bridge';
import { WorkspacePanelSystem } from './panel-system';

/**
 * Create the IWSDK world for the spatial workspace. Loaded lazily so the 2D app
 * does not pay for three.js and the UI kit until the user opens the Spatial view.
 */
export async function createWorkspaceWorld(
  container: HTMLElement,
  bridge: XrBridge,
): Promise<{ world: World; panels: WorkspacePanelSystem }> {
  const world = await World.create(container, projectOptions);
  (world.globals as Record<string, unknown>)[BRIDGE_KEY] = bridge;
  world.registerSystem(WorkspacePanelSystem, { priority: 30 });
  const panels = world.getSystem(WorkspacePanelSystem);
  if (!panels) throw new Error('WorkspacePanelSystem failed to register');
  return { world, panels };
}
