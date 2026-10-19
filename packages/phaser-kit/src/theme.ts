import type Phaser from 'phaser';

/**
 * 低饱和暖色 + 竹绿 + 米白 + 浅木 —— 儿童向，不刺眼。
 * 描边用深棕而不是纯黑：圆润卡通的关键是"柔和的边"，不是"漫画的墨线"。
 */
export const THEME = {
  outline: 0x4a3b2f,
  ink: 0x4a3b2f,
  inkSoft: 0x7b6a5a,
  paper: 0xfaf3e7,
  paperDeep: 0xf0e4cf,
  card: 0xfffdf8,
  bamboo: 0x7aa05c,
  bambooDeep: 0x55793f,
  bambooLight: 0xa8c68a,
  cream: 0xf7ead6,
  wood: 0xd3a97c,
  woodDeep: 0xa97e50,
  blush: 0xf2b8ae,
  pink: 0xe8a79e,
  sky: 0xdfeff0,
  skyDeep: 0xbcdde1,
  water: 0x9fd0d6,
  waterDeep: 0x6fb2ba,
  sun: 0xf5cf7a,
  gold: 0xf2c14e,
  goldDeep: 0xb9822a,
  warmRed: 0xe07a6a,
  warmRedDeep: 0xb9523f,
  mint: 0xcfe6d4,
  lavender: 0xd9d2ea,
  white: 0xffffff,
  pandaWhite: 0xfbf7ef,
  pandaBlack: 0x3b3a37,
  grey: 0xb8b2a8,
  shadow: 0x4a3b2f,
} as const;

export const CSS = {
  ink: '#4a3b2f',
  inkSoft: '#7b6a5a',
  paper: '#faf3e7',
  card: '#fffdf8',
  bamboo: '#55793f',
  bambooDeep: '#44663a',
  gold: '#8a5f10',
  warmRed: '#b9523f',
  white: '#ffffff',
  grey: '#7a746b',
} as const;

export const FONT_STACK =
  '"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

export function textStyle(
  size: number,
  color: string = CSS.ink,
  bold = false,
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT_STACK,
    fontSize: size + 'px',
    color,
    fontStyle: bold ? 'bold' : 'normal',
  };
}
