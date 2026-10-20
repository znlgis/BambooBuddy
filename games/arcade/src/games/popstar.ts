import type { ArcadeManifest } from '@bamboo/game-kit';
import { ARCADE_DESIGN } from '../arcadeScene';
import { defineArcadeGame } from '../defineArcadeGame';
import { createPopstarScene } from '../popstar.scene';

export const manifest: ArcadeManifest = {
  id: 'popstar',
  title: '消灭星星',
  version: '0.1.0',
  designSize: { width: ARCADE_DESIGN.width, height: ARCADE_DESIGN.height },
  ageRange: [4, 8],
};

export default defineArcadeGame({
  manifest,
  scenes: (ctx) => [createPopstarScene(ctx)],
});
