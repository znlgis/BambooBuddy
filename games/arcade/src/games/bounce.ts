import type { ArcadeManifest } from '@bamboo/game-kit';
import { ARCADE_DESIGN } from '../arcadeScene';
import { defineArcadeGame } from '../defineArcadeGame';
import { createBounceScene } from '../bounce.scene';

export const manifest: ArcadeManifest = {
  id: 'bounce',
  title: '弹一弹',
  version: '0.1.0',
  designSize: { width: ARCADE_DESIGN.width, height: ARCADE_DESIGN.height },
  ageRange: [4, 8],
};

export default defineArcadeGame({
  manifest,
  scenes: (ctx) => [createBounceScene(ctx)],
});
