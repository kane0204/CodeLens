<script setup lang="ts">
import { computed } from 'vue'

type Kind = 'total' | 'agent'
type Tone = 'input' | 'agent' | 'repair' | 'decision' | 'database'
type Node = [label: string, x: number, y: number, w: number, h: number, tone: Tone]
type Edge = [path: string, label?: string, x?: number, y?: number, style?: 'history' | 'both']

const { kind } = defineProps<{ kind: Kind }>()

const diagrams: Record<Kind, { groups: [string, number, number, number, number][]; nodes: Node[]; edges: Edge[] }> = {
  total: {
    groups: [['前端', 5, 5, 160, 405], ['后端（静态分析）', 193, 5, 402, 405], ['Agent 与记忆', 628, 5, 267, 405]],
    nodes: [
      ['导入项目', 19, 56, 132, 36, 'input'],
      ['提交分析任务', 19, 117, 132, 40, 'input'],
      ['结果展示', 19, 298, 132, 39, 'input'],
      ['源码回查与导出', 12, 362, 146, 38, 'input'],
      ['文件识别（结构、语言）', 270, 43, 244, 37, 'input'],
      ['Python\n：AST(tokenize)', 211, 103, 163, 57, 'input'],
      ['其他语言\n：类AST(tokenize)函数', 399, 103, 182, 57, 'input'],
      ['生成IR、CFG、\ndef-use等/定量计算code smell', 250, 187, 285, 56, 'input'],
      ['切片/静态证据', 286, 264, 212, 33, 'input'],
      ['静态报告', 286, 323, 212, 38, 'input'],
      ['配置模型？', 688, 37, 146, 68, 'decision'],
      ['Agent处理', 691, 133, 140, 39, 'agent'],
      ['缓存 / 历史线索 / 检查点', 647, 202, 228, 37, 'agent'],
      ['结果合并', 691, 267, 140, 38, 'input'],
      ['PostgreSQL\n分析历史', 683, 333, 156, 61, 'database'],
    ],
    edges: [
      ['M85 92 V117'], ['M85 337 V362'],
      ['M151 137 H178 V62 H270'],
      ['M392 80 V92 H292 V103'], ['M392 80 V92 H490 V103'],
      ['M292 160 V173 H392 V187'], ['M490 160 V173 H392 V187'],
      ['M392 243 V264'], ['M392 297 V323'],
      ['M498 335 H606 V71 H688'],
      ['M761 105 V133', '是', 777, 121],
      ['M712 60 H614 V420 H173 V310 H151', '否', 592, 419],
      ['M761 172 V202', undefined, undefined, undefined, 'both'],
      ['M831 152 H884 V286 H831'],
      ['M498 350 H683'], ['M761 305 V333'],
      ['M691 286 H619 V309 H182 V318 H151'],
      ['M761 394 V436 H182 V330 H151', '历史回看', 362, 434, 'history'],
    ],
  },
  agent: {
    groups: [],
    nodes: [
      ['静态处理结果', 32, 48, 172, 48, 'input'],
      ['构造上下文', 350, 48, 172, 48, 'agent'],
      ['缓存命中？', 678, 26, 186, 92, 'decision'],
      ['模型处理', 685, 175, 172, 48, 'agent'],
      ['（gap函数）\n校验通过？', 336, 147, 200, 104, 'decision'],
      ['补充一次上下文\n（仅有一次）', 30, 168, 176, 62, 'repair'],
      ['还有下一部分？', 336, 295, 200, 104, 'decision'],
      ['输出结果', 30, 323, 176, 48, 'agent'],
      ['输出已有结果', 685, 323, 172, 48, 'agent'],
    ],
    edges: [
      ['M204 72 H350'], ['M522 72 H678'],
      ['M771 118 V175', '否', 787, 146],
      ['M864 72 H880 V347 H857', '是', 866, 277],
      ['M685 199 H536'], ['M336 199 H206', '否', 270, 184],
      ['M118 168 V124 H411 V96'], ['M436 251 V295', '是', 453, 272],
      ['M336 347 H206', '否', 271, 331],
      ['M436 399 V420 H11 V16 H436 V48', '是', 28, 302],
    ],
  },
}

const diagram = computed(() => diagrams[kind])
const arrow = computed(() => `url(#workflow-arrow-${kind})`)
const colors: Record<Tone, string> = {
  input: '#173a63',
  agent: '#285d6b',
  repair: '#4b3040',
  decision: '#0f2744',
  database: '#173a63',
}
</script>

<template>
  <svg class="workflow-diagram" viewBox="0 0 900 448" role="img"
    :aria-label="kind === 'total' ? '总工作流' : 'Agent工作流：Plan-and-Execute'">
    <defs>
      <marker :id="`workflow-arrow-${kind}`" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse">
        <path d="M0 0 L8 4 L0 8 Z" fill="#b5c2cf" />
      </marker>
    </defs>
    <g v-for="([label, x, y, w, h]) in diagram.groups" :key="label">
      <rect :x="x" :y="y" :width="w" :height="h" rx="6" fill="#34383e" stroke="#7e8894" />
      <text :x="x + w / 2" :y="y + 17" class="group-label">{{ label }}</text>
    </g>
    <path v-for="([path, , , , style]) in diagram.edges" :key="path" :d="path"
      fill="none" stroke="#b5c2cf" stroke-width="1.35"
      :stroke-dasharray="style === 'history' ? '4 4' : undefined"
      :marker-start="style === 'both' ? arrow : undefined" :marker-end="arrow" />
    <g v-for="([label, x, y, w, h, tone]) in diagram.nodes" :key="label">
      <polygon v-if="tone === 'decision'" :points="`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`"
        :fill="colors[tone]" stroke="#7895b2" />
      <template v-else-if="tone === 'database'">
        <path :d="`M${x} ${y + 8} V${y + h - 8} a${w / 2} 8 0 0 0 ${w} 0 V${y + 8} Z`" :fill="colors[tone]" stroke="#7895b2" />
        <ellipse :cx="x + w / 2" :cy="y + 8" :rx="w / 2" ry="8" fill="#224b74" stroke="#7895b2" />
      </template>
      <rect v-else :x="x" :y="y" :width="w" :height="h" rx="3" :fill="colors[tone]" stroke="#7895b2" />
      <text v-for="(line, i) in label.split('\n')" :key="i" :x="x + w / 2"
        :y="y + h / 2 + (tone === 'database' ? 6 : 0) + (i - (label.split('\n').length - 1) / 2) * 19">
        {{ line }}
      </text>
    </g>
    <g v-for="([path, label, x, y]) in diagram.edges" :key="path">
      <text v-if="label" :x="x" :y="y" class="edge-label">{{ label }}</text>
    </g>
  </svg>
</template>

<style scoped>
.workflow-diagram {
  display: block;
  width: 100%;
  height: auto;
  max-height: 442px;
  margin: 8px auto 0;
}

text {
  fill: #fff;
  font: 500 16px system-ui, "Microsoft YaHei", sans-serif;
  text-anchor: middle;
  dominant-baseline: central;
}

.group-label {
  font-weight: 700;
}

.edge-label {
  font-size: 14px;
  paint-order: stroke;
  stroke: #24272b;
  stroke-width: 4px;
  stroke-linejoin: round;
}
</style>
