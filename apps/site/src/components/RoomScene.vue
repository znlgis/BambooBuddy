<script setup lang="ts">
import type { RoomSlot } from '@bamboo/game-kit';
import { computed } from 'vue';

/**
 * 小屋背景。房间布置完全由存档里的 pet.room 决定：
 * 墙纸 / 小床 / 书架 / 玩具角 / 地毯五个槽位各有一件在用的物件。
 * 全部是 SVG 几何绘制 —— 小窝换一张墙纸不应该多下载一张图。
 */
interface Props {
  room?: Partial<Record<RoomSlot, string>>;
}

const props = withDefaults(defineProps<Props>(), {
  room: () => ({}),
});

const forestWall = computed(() => props.room.wallpaper === 'room-wall-forest');
const flowerRug = computed(() => props.room.rug === 'room-rug-flower');
const hasBed = computed(() => props.room.bed === 'room-bed-cloud');
const hasShelf = computed(() => props.room.shelf === 'room-shelf');
const hasToy = computed(() => props.room.toyCorner === 'room-toy');
</script>

<template>
  <div class="room-scene pointer-events-none absolute inset-0" aria-hidden="true">
    <svg viewBox="0 0 400 280" preserveAspectRatio="xMidYMax slice" class="h-full w-full">
      <!-- 墙 -->
      <rect x="0" y="0" width="400" height="192" :fill="forestWall ? '#eef3e3' : '#faf3e7'" />

      <!-- 竹林墙纸：几根竹子 + 叶子 -->
      <g v-if="forestWall" opacity="0.9">
        <g v-for="(x, index) in [34, 78, 322, 364]" :key="x">
          <rect :x="x" y="16" width="9" :height="176" fill="#a8c68a" />
          <line
            v-for="node in [58, 104, 150]" :key="node"
            :x1="x" :y1="node" :x2="x + 9" :y2="node"
            stroke="#7aa05c" stroke-width="2"
          />
          <ellipse
            :cx="x + (index % 2 === 0 ? 20 : -14)" cy="70" rx="17" ry="6"
            fill="#a8c68a" transform="rotate(-18 20 70)"
          />
        </g>
      </g>

      <!-- 窗 -->
      <g>
        <rect x="46" y="36" width="102" height="82" rx="8" fill="#dfeff0" stroke="#d3a97c" stroke-width="5" />
        <circle cx="122" cy="60" r="10" fill="#f5cf7a" />
        <g fill="#fffdf8" opacity="0.9">
          <ellipse cx="76" cy="66" rx="16" ry="9" />
          <ellipse cx="90" cy="62" rx="12" ry="8" />
          <ellipse cx="64" cy="64" rx="10" ry="7" />
        </g>
        <line x1="97" y1="36" x2="97" y2="118" stroke="#d3a97c" stroke-width="4" />
        <line x1="46" y1="77" x2="148" y2="77" stroke="#d3a97c" stroke-width="4" />
        <rect x="34" y="30" width="12" height="96" rx="5" fill="#f2b8ae" />
        <rect x="148" y="30" width="12" height="96" rx="5" fill="#f2b8ae" />
      </g>

      <!-- 小书架 -->
      <g v-if="hasShelf">
        <rect x="288" y="92" width="82" height="76" rx="8" fill="#d3a97c" stroke="#4a3b2f" stroke-width="4" />
        <rect x="294" y="128" width="70" height="5" fill="#a97e50" />
        <rect x="300" y="104" width="12" height="24" rx="2" fill="#b9523f" />
        <rect x="316" y="100" width="12" height="28" rx="2" fill="#7aa05c" />
        <rect x="332" y="106" width="12" height="22" rx="2" fill="#e6c479" />
        <rect x="348" y="102" width="12" height="26" rx="2" fill="#b9b2d6" />
        <rect x="304" y="140" width="14" height="22" rx="2" fill="#e6c479" />
        <rect x="324" y="138" width="14" height="24" rx="2" fill="#d98070" />
      </g>

      <!-- 地板与踢脚线 -->
      <rect x="0" y="192" width="400" height="88" fill="#e7d3b4" />
      <rect x="0" y="188" width="400" height="8" fill="#d3a97c" />
      <g stroke="#dcc3a1" stroke-width="3">
        <line x1="20" y1="196" x2="-10" y2="280" />
        <line x1="120" y1="196" x2="90" y2="280" />
        <line x1="220" y1="196" x2="190" y2="280" />
        <line x1="320" y1="196" x2="290" y2="280" />
      </g>

      <!-- 地毯 -->
      <g>
        <ellipse
          cx="232" cy="242" rx="118" ry="31"
          :fill="flowerRug ? '#f2d9a8' : '#a8c68a'" stroke="#4a3b2f" stroke-width="3"
        />
        <ellipse
          cx="232" cy="242" rx="92" ry="22"
          :fill="flowerRug ? '#f7e6c4' : '#bcd6a3'"
        />
        <g v-if="flowerRug">
          <g v-for="(x, index) in [176, 232, 288]" :key="x">
            <circle :cx="x" cy="242" r="5" fill="#f2b8ae" />
            <circle :cx="x - 6" cy="236" r="3.5" fill="#f2b8ae" />
            <circle :cx="x + 6" cy="236" r="3.5" fill="#f2b8ae" />
            <circle :cx="x" cy="236" r="3" fill="#e6c479" />
            <line
              :x1="x" y1="246" :x2="x + (index % 2 === 0 ? 4 : -4)" y2="252"
              stroke="#7aa05c" stroke-width="2"
            />
          </g>
        </g>
      </g>

      <!-- 云朵床 -->
      <g v-if="hasBed">
        <rect x="34" y="196" width="112" height="46" rx="18" fill="#fffdf8" stroke="#4a3b2f" stroke-width="3" />
        <g fill="#eef4f7">
          <ellipse cx="58" cy="208" rx="22" ry="14" />
          <ellipse cx="92" cy="202" rx="24" ry="16" />
          <ellipse cx="124" cy="209" rx="20" ry="13" />
        </g>
        <rect x="50" y="212" width="80" height="24" rx="10" fill="#b9b2d6" stroke="#4a3b2f" stroke-width="3" />
        <ellipse cx="66" cy="206" rx="14" ry="7" fill="#fffdf8" />
      </g>

      <!-- 玩具角 -->
      <g v-if="hasToy">
        <circle cx="42" cy="252" r="12" fill="#d98070" stroke="#4a3b2f" stroke-width="2" />
        <circle cx="42" cy="252" r="5" fill="#fffdf8" opacity="0.8" />
        <rect x="58" y="244" width="18" height="18" rx="4" fill="#e6c479" stroke="#4a3b2f" stroke-width="2" />
        <rect x="68" y="252" width="18" height="18" rx="4" fill="#7aa05c" stroke="#4a3b2f" stroke-width="2" />
        <g>
          <circle cx="104" cy="248" r="11" fill="#d3a97c" />
          <circle cx="96" cy="241" r="5" fill="#d3a97c" />
          <circle cx="112" cy="241" r="5" fill="#d3a97c" />
          <circle cx="100" cy="247" r="1.8" fill="#4a3b2f" />
          <circle cx="108" cy="247" r="1.8" fill="#4a3b2f" />
          <circle cx="104" cy="252" r="2" fill="#4a3b2f" />
        </g>
      </g>

      <!-- 竹子小盆栽（每个小窝都有的一点绿） -->
      <g>
        <path d="M348 268 l6 -28 h28 l6 28 z" fill="#d3a97c" stroke="#4a3b2f" stroke-width="3" />
        <rect x="360" y="196" width="5" height="46" fill="#7aa05c" />
        <rect x="370" y="206" width="5" height="36" fill="#7aa05c" />
        <ellipse cx="356" cy="200" rx="12" ry="5" fill="#a8c68a" transform="rotate(-20 356 200)" />
        <ellipse cx="380" cy="210" rx="12" ry="5" fill="#a8c68a" transform="rotate(18 380 210)" />
      </g>
    </svg>
  </div>
</template>
