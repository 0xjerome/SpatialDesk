/**
 * Asset manifest for the immersive workspace.
 *
 * This module is evaluated by both the app runtime and the IWSDK editor, so it
 * must stay deterministic and side-effect free: no World, DOM or timers.
 */
import { AssetType, BoxGeometry, Mesh, MeshStandardMaterial, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

/** A slim bar the user grabs to reposition a panel. Dimensions are metres. */
function createPanelHandle(): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(0.42, 0.028, 0.028),
    new MeshStandardMaterial({ color: 0x8c9bff, roughness: 0.35, metalness: 0.1 }),
  );
  mesh.name = 'PanelHandle';
  mesh.castShadow = false;
  return mesh;
}

export default defineAssets({
  'workspace-panel': {
    url: publicAssetUrl('ui/workspace.uikitml'),
    type: AssetType.UIKitML,
    name: 'Workspace Panel',
  },
  'detail-panel': {
    url: publicAssetUrl('ui/detail.uikitml'),
    type: AssetType.UIKitML,
    name: 'Detail Panel',
  },
  'panel-handle': createPanelHandle(),
});
