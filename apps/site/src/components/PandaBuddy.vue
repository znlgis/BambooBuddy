<script setup lang="ts">
import type { ClothingSlot } from '@bamboo/game-kit';
import { computed } from 'vue';
import { PANDA_COLORS, clothingColor, faceFor, hatKind } from '../logic/pandaLook';
import type { PandaMood } from '../logic/pandaLook';

/**
 * 竹竹的程序化 SVG 像。所有形状都是几何绘制：不引入任何图片/字体/外部资源，
 * 断网、离线包、截图比对都稳定。
 *
 * 为什么用 SVG 而不是再放一个 Phaser 画布：小屋是 DOM 界面（文字、按钮都是 DOM），
 * 把熊猫单独做成一块 canvas 会让"点竹竹摸头"这类手势落点变得不可控。
 */
interface Props {
  mood?: PandaMood;
  /** 成长阶段带来的体型（0.82–1.08），与 progress/growth 的 scale 对齐 */
  stageScale?: number;
  /** 已穿上的装扮 id（catalog 里的 id） */
  equipped?: Partial<Record<ClothingSlot, string>>;
}

const props = withDefaults(defineProps<Props>(), {
  mood: 'happy',
  stageScale: 1,
  equipped: () => ({}),
});

const face = computed(() => faceFor(props.mood));
const hat = computed(() => hatKind(props.equipped.hat));
const hatFill = computed(() => clothingColor(props.equipped.hat));
const bibFill = computed(() => clothingColor(props.equipped.bib));
const outfitFill = computed(() => clothingColor(props.equipped.outfit));
const backpackFill = computed(() => clothingColor(props.equipped.backpack));
const shoesFill = computed(() => clothingColor(props.equipped.shoes));
const scaleStyle = computed(() => ({ transform: 'scale(' + props.stageScale + ')' }));
</script>

<template>
  <div
    class="panda-buddy"
    :style="scaleStyle"
    role="img"
    aria-label="竹竹"
  >
    <svg viewBox="0 0 260 300" class="h-full w-full" aria-hidden="true">
      <g class="panda-breathe">
        <!-- 影子 -->
        <ellipse cx="130" cy="288" rx="80" ry="11" :fill="PANDA_COLORS.ink" opacity="0.13" />

        <!-- 小书包背在身后：比身体宽一点，两侧才会露出来 -->
        <g v-if="props.equipped.backpack">
          <rect
            x="58" y="156" width="144" height="96" rx="28"
            :fill="backpackFill" :stroke="PANDA_COLORS.ink" stroke-width="4"
          />
          <rect
            x="88" y="194" width="84" height="46" rx="14"
            :fill="backpackFill" :stroke="PANDA_COLORS.ink" stroke-width="3" opacity="0.85"
          />
          <rect
            x="111" y="184" width="38" height="13" rx="6"
            :fill="PANDA_COLORS.gold" :stroke="PANDA_COLORS.ink" stroke-width="2"
          />
        </g>

        <!-- 脚与鞋 -->
        <ellipse cx="100" cy="270" rx="25" ry="17" :fill="PANDA_COLORS.black" />
        <ellipse cx="160" cy="270" rx="25" ry="17" :fill="PANDA_COLORS.black" />
        <g v-if="props.equipped.shoes">
          <ellipse
            cx="100" cy="276" rx="27" ry="13"
            :fill="shoesFill" :stroke="PANDA_COLORS.ink" stroke-width="3"
          />
          <ellipse
            cx="160" cy="276" rx="27" ry="13"
            :fill="shoesFill" :stroke="PANDA_COLORS.ink" stroke-width="3"
          />
        </g>

        <!-- 身体 -->
        <ellipse
          cx="130" cy="205" rx="60" ry="67"
          :fill="PANDA_COLORS.white" :stroke="PANDA_COLORS.ink" stroke-width="4"
        />

        <!-- 睡衣 / 小雨衣 -->
        <g v-if="props.equipped.outfit">
          <ellipse
            cx="130" cy="210" rx="58" ry="64"
            :fill="outfitFill" :stroke="PANDA_COLORS.ink" stroke-width="4"
          />
          <circle v-for="offset in [180, 205, 230]" :key="offset" cx="130" :cy="offset" r="4" :fill="PANDA_COLORS.gold" />
        </g>

        <!-- 书包肩带（画在身体与衣服之上，才看得出是背着的） -->
        <g v-if="props.equipped.backpack">
          <rect
            x="86" y="158" width="13" height="70" rx="6.5"
            :fill="backpackFill" :stroke="PANDA_COLORS.ink" stroke-width="2.5"
          />
          <rect
            x="161" y="158" width="13" height="70" rx="6.5"
            :fill="backpackFill" :stroke="PANDA_COLORS.ink" stroke-width="2.5"
          />
        </g>

        <!-- 短手 -->
        <ellipse
          cx="68" cy="212" rx="16" ry="25"
          :fill="PANDA_COLORS.black" transform="rotate(-20 68 212)"
        />
        <ellipse
          cx="192" cy="212" rx="16" ry="25"
          :fill="PANDA_COLORS.black" transform="rotate(20 192 212)"
        />

        <!-- 围兜 -->
        <g v-if="props.equipped.bib">
          <ellipse
            cx="130" cy="180" rx="29" ry="22"
            :fill="bibFill" :stroke="PANDA_COLORS.ink" stroke-width="3"
          />
          <polygon
            :points="'0,-9 2.65,-3.64 8.56,-2.78 4.28,1.39 5.29,7.28 0,4.5 -5.29,7.28 -4.28,1.39 -8.56,-2.78 -2.65,-3.64'"
            transform="translate(130 180)"
            :fill="PANDA_COLORS.white" opacity="0.85"
          />
        </g>

        <!-- 头 -->
        <g>
          <circle cx="74" cy="72" r="26" :fill="PANDA_COLORS.black" />
          <circle cx="186" cy="72" r="26" :fill="PANDA_COLORS.black" />
          <circle cx="74" cy="72" r="12" fill="#5a5854" />
          <circle cx="186" cy="72" r="12" fill="#5a5854" />
          <circle
            cx="130" cy="118" r="68"
            :fill="PANDA_COLORS.white" :stroke="PANDA_COLORS.ink" stroke-width="4"
          />
          <!-- 眼斑 -->
          <ellipse cx="103" cy="112" rx="17" ry="23" :fill="PANDA_COLORS.black" transform="rotate(-14 103 112)" />
          <ellipse cx="157" cy="112" rx="17" ry="23" :fill="PANDA_COLORS.black" transform="rotate(14 157 112)" />

          <!-- 眼睛：睁眼时慢慢眨；困了就是两道弯弯的线 -->
          <g v-if="face.eyes === 'open'" class="panda-eye">
            <circle cx="103" cy="110" r="6.5" :fill="PANDA_COLORS.eyeShine" />
            <circle cx="104.5" cy="111" r="3.6" :fill="PANDA_COLORS.black" />
            <circle cx="105.5" cy="109" r="1.6" :fill="PANDA_COLORS.eyeShine" />
            <circle cx="157" cy="110" r="6.5" :fill="PANDA_COLORS.eyeShine" />
            <circle cx="158.5" cy="111" r="3.6" :fill="PANDA_COLORS.black" />
            <circle cx="159.5" cy="109" r="1.6" :fill="PANDA_COLORS.eyeShine" />
          </g>
          <g v-else>
            <path
              d="M95 111 q8 8 16 0"
              :stroke="PANDA_COLORS.black" stroke-width="3.5" stroke-linecap="round" fill="none"
            />
            <path
              d="M149 111 q8 8 16 0"
              :stroke="PANDA_COLORS.black" stroke-width="3.5" stroke-linecap="round" fill="none"
            />
          </g>

          <!-- 鼻子与嘴 -->
          <ellipse cx="130" cy="137" rx="8.5" ry="6" :fill="PANDA_COLORS.black" />
          <path
            v-if="face.mouth === 'smile'"
            d="M112 151 q18 16 36 0"
            :stroke="PANDA_COLORS.ink" stroke-width="3.5" stroke-linecap="round" fill="none"
          />
          <line
            v-else-if="face.mouth === 'flat'"
            x1="117" y1="152" x2="143" y2="152"
            :stroke="PANDA_COLORS.ink" stroke-width="3.5" stroke-linecap="round"
          />
          <path
            v-else-if="face.mouth === 'frown'"
            d="M114 159 q16 -12 32 0"
            :stroke="PANDA_COLORS.ink" stroke-width="3.5" stroke-linecap="round" fill="none"
          />
          <g v-else>
            <ellipse cx="130" cy="157" rx="13" ry="10" fill="#b9523f" :stroke="PANDA_COLORS.ink" stroke-width="3" />
            <ellipse cx="130" cy="163" rx="7" ry="4" fill="#efc2bb" />
          </g>

          <!-- 腮红 -->
          <ellipse cx="85" cy="146" rx="11" ry="7" :fill="PANDA_COLORS.blush" opacity="0.75" />
          <ellipse cx="175" cy="146" rx="11" ry="7" :fill="PANDA_COLORS.blush" opacity="0.75" />

          <!-- 难过时的一滴眼泪（只是一滴，不夸张） -->
          <ellipse v-if="face.tear" cx="98" cy="132" rx="3.5" ry="6" fill="#9ec9d8" />

          <!-- 玩脏了的小泥点 -->
          <g v-if="face.dirt" fill="#a97e50" opacity="0.55">
            <circle cx="152" cy="150" r="4" />
            <circle cx="86" cy="96" r="3" />
            <circle cx="112" cy="214" r="4.5" />
            <circle cx="166" cy="226" r="3.5" />
          </g>
        </g>

        <!-- 帽子：三种形态各画各的 -->
        <g v-if="hat === 'bamboo'">
          <ellipse cx="130" cy="58" rx="58" ry="10" :fill="hatFill" :stroke="PANDA_COLORS.ink" stroke-width="3" />
          <ellipse
            cx="116" cy="42" rx="24" ry="9" :fill="hatFill" :stroke="PANDA_COLORS.ink" stroke-width="2"
            transform="rotate(-24 116 42)"
          />
          <ellipse
            cx="146" cy="34" rx="20" ry="8" :fill="hatFill" :stroke="PANDA_COLORS.ink" stroke-width="2"
            transform="rotate(22 146 34)"
          />
        </g>
        <g v-else-if="hat === 'straw'">
          <ellipse cx="130" cy="62" rx="82" ry="14" :fill="hatFill" :stroke="PANDA_COLORS.ink" stroke-width="3" />
          <ellipse cx="130" cy="42" rx="40" ry="23" :fill="hatFill" :stroke="PANDA_COLORS.ink" stroke-width="3" />
          <rect x="96" y="58" width="68" height="8" rx="4" fill="#c9a45c" />
        </g>
        <g v-else-if="hat === 'crown'">
          <polygon
            points="98,50 112,18 130,40 148,18 162,50"
            :fill="hatFill" :stroke="PANDA_COLORS.ink" stroke-width="3"
          />
          <rect x="96" y="46" width="68" height="10" rx="5" :fill="hatFill" :stroke="PANDA_COLORS.ink" stroke-width="2" />
          <circle cx="130" cy="28" r="4" fill="#f5e6b8" />
        </g>

        <!-- 打瞌睡的小 z -->
        <g v-if="face.sleepy" class="panda-zzz" fill="#7b6a5a" font-size="20" font-weight="bold">
          <text x="196" y="56">z</text>
          <text x="212" y="40" font-size="16">z</text>
          <text x="224" y="26" font-size="12">z</text>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.panda-buddy {
  display: block;
  width: 100%;
  height: 100%;
  transform-origin: 50% 100%;
  transition: transform 600ms ease;
}

/* 呼吸：幅度只有 1–3%，看得出"活着"但不晃眼 */
.panda-breathe {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: panda-breathe 4.8s ease-in-out infinite;
}

@keyframes panda-breathe {
  0%,
  100% {
    transform: scale(1, 1);
  }
  50% {
    transform: scale(1.012, 1.028);
  }
}

/* 眨眼：5.4 秒里眨两下，比"定期闭眼"更像真的 */
.panda-eye {
  transform-box: fill-box;
  transform-origin: 50% 50%;
  animation: panda-blink 5.4s ease-in-out infinite;
}

@keyframes panda-blink {
  0%,
  91%,
  100% {
    transform: scaleY(1);
  }
  93.5%,
  96% {
    transform: scaleY(0.08);
  }
}

.panda-zzz {
  animation: panda-zzz 3.2s ease-in-out infinite;
}

@keyframes panda-zzz {
  0%,
  100% {
    opacity: 0.65;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-4px);
  }
}

/* 系统开了"减少动态效果"：呼吸、眨眼、小 z 全部停掉 */
@media (prefers-reduced-motion: reduce) {
  .panda-buddy,
  .panda-breathe,
  .panda-eye,
  .panda-zzz {
    animation: none;
    transition: none;
  }
}
</style>
