import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ModuleDto } from '../../core/types';
import type { DeviceKind, DeviceState } from '../../protocol/types';
import { DEVICE_META } from '../../protocol/profiles';

/* ------------------------------------------------------------------
 * 真型铁塔 3D 场景（真 3D，单位：米）
 * 世界坐标：X = 横担方向，Y = 竖直（塔顶 y=0，向下为负），Z = 线路方向。
 * 尺寸取自 STEP 实测：呼高 41m、横担半跨 23.28m、塔脚 -69.9m。
 * ------------------------------------------------------------------ */

const BODY_BOTTOM = -69.8;

/** 塔身半宽（m）：取自 tension-tower.glb 实测轮廓，分段线性插值 */
const BODY_PROFILE: Array<[number, number]> = [
  [-69.8, 8.44],
  [-69, 8.26],
  [-64, 7.35],
  [-60, 6.99],
  [-56, 6.42],
  [-51, 5.65],
  [-46, 4.99],
  [-43, 4.52],
  [-39, 4.01],
  [-36, 3.66],
  [-32, 3.32],
  [-29, 3.04],
  [-25, 2.67],
  [-23, 2.47],
  [-20, 2.12],
  [-18, 2.04],
  [-17, 1.98],
  [-12, 1.72],
  [-10, 1.62],
  [-8, 1.51],
  [-6, 1.4],
  [-5, 1.43],
];

function bodyHalf(y: number): number {
  if (y <= BODY_PROFILE[0][0]) return BODY_PROFILE[0][1];
  for (let i = 0; i < BODY_PROFILE.length - 1; i += 1) {
    const [y0, h0] = BODY_PROFILE[i];
    const [y1, h1] = BODY_PROFILE[i + 1];
    if (y <= y1) return h0 + ((y - y0) / (y1 - y0)) * (h1 - h0);
  }
  return BODY_PROFILE[BODY_PROFILE.length - 1][1];
}

/* 横担几何：tension-tower.glb 实测，上弦 -12.7 / 下弦 -15.02 / 顺线路半宽 2.19 */
const ARM_TIP_X = 23.18;
const ARM_TOP_Y = -12.7;
const ARM_BOT_Y = -15.02;
const ARM_BOT_Z = 2.19;
const armBotY = () => ARM_BOT_Y;

/* 地线挂点（tension-tower.glb 实测） */
const PEAK_X = 14.81;
const PEAK_Y = 0.1;

/* 引流导线贴着最近的塔腿向下：沿 +X/+Z 角外侧、再外偏 DRAIN_OFFSET 到绝缘子末端 */
const DRAIN_OFFSET = 0.38;
/** 支撑绝缘子的卡端直接卡在塔身外表面上（原来留 0.12m 空隙，看起来悬空） */
const DRAIN_LEG_FACE = 0;
/** 引下线沿 +X/+Z 角引下：卡端落在塔身角钢上，卡箍端在 DRAIN_OFFSET 处抱住导线 */
const DRAIN_CORNER_GAP = 0.03;

/** 传动机构整体上抬量：顶部固定板顶面（模型原始 -17.281）与横担下弦底面贴合，
 *  驱动器不再用细吊板悬在横担下方 */
const DRIVE_RISE = 2.261;
/** 融冰刀闸：转轴（减速器输出转盘）随传动机构一起上抬，合闸竖直，分闸顺时针 90° 贴向塔身。
 *  X 与减速器输出中心对齐（实物模型输出中心偏 -X 约 0.18m） */
const ICE_PIVOT = new THREE.Vector3(12.1, -18.05 + DRIVE_RISE, 0);
/** 导电杆在 rodGroup 局部坐标中的上下端：
 *  上端直接插入减速器端部连接板的圆柱筒；
 *  下端合闸时套抱箍，抱箍触指从引流器上部罩子的开口水平插入罩内。
 *  传动机构上抬后导电杆随之加长，杆端仍落在引流器罩口中心 */
const ROD_TOP_LOCAL = -0.12;
/* 导电杆缩短 0.55m：分闸端的融冰锁正好落进保护罩抽屉位（罩内 x 1.93~3.19，锁心 2.56），
 * 缩短后合闸端仍能插入引流器，因此跳线串整体同步上抬 0.55m（见 JUMPER_Y） */
const ROD_TIP_LOCAL = -9.631;
const ICE_ROD_LEN = ROD_TIP_LOCAL - ROD_TOP_LOCAL;
/** 分闸到位时杆端相对转轴抬高的量：越过 90° 再转一点，杆端正好升到抽屉里的融冰锁高度 */
const ICE_OPEN_RISE = 0.45 - 0.069;
const ICE_OPEN_ANGLE = -Math.PI / 2 - Math.asin(ICE_OPEN_RISE / Math.abs(ROD_TIP_LOCAL));
/** 杆身为贯通整根的缓锥：上端略粗插入减速器连接筒，末端收细正好插入抱箍通孔 */
const ROD_TOP_RADIUS = 0.045;
const ROD_TIP_RADIUS = 0.024;
/** 导电杆平均直径：各处平移量都按杆径换算（2 个杆径 ≈ 0.18m，1.5 个杆径 ≈ 0.135m） */
const ROD_DIAMETER = (ROD_TOP_RADIUS + ROD_TIP_RADIUS);
/** 分闸状态导电杆（连同端部环与抱箍）沿线路方向的偏移量。
 *  取 0：杆身轴线与引流器罩口同轴，合闸时杆端正好插进罩内（原来右移 2 个杆径会偏出罩口） */
const ROD_Z_SHIFT = 0;
/** 保护罩、融冰锁随导电杆一起左移 2 个杆径，保持三者相对位置不变 */
const ICE_Z_SHIFT = 2 * ROD_DIAMETER;
/** 抱箍孔心在杆上的高度：与引流器上部罩子中心同高，触指水平插入罩内 */
const BAND_HOLE_Y = ROD_TIP_LOCAL + 0.057;
/** 抱箍：模型通孔半径 37mm，缩放 0.7 后孔半径 26mm，正好套住收细后的杆端 */
const BAND_SCALE = 0.0007;
/** 端部环：环面垂直于线路方向，两只脚板搭在两个环抱箍上。
 *  RING_ROD_DY 为环心相对杆端的轴向偏置：原 0.09m，现向杆中再移一个环长（0.2m）；
 *  RING_ROD_DX 为环心相对杆轴的径向偏置：向上抬 1.5 个杆径，使环上的孔与两只环抱箍的耳孔同高；
 *  RING_HOLE_OFFSET 为环孔中心相对杆轴的高度：分闸到位时与融冰锁锁舌同轴 */
const RING_ROD_DY = 0.09 + 0.2;
const RING_ROD_DX = -0.044 - 1.5 * ROD_DIAMETER;
const RING_FOOT_DY = 0.109;
const RING_HOLE_OFFSET = 0.11;
/** 引流器：位于导电杆正下方、两片 V 形悬垂串中间，六爪中心对准跳线束中心 (-25.9)；
 *  模型原点相对六爪中心偏 (0, -212.5mm)，实例化时按缩放补偿。
 *  导电杆缩短 0.55m 后合闸端抬高，整个跳线串（跳线 / 鼠笼管 / 间隔棒 / 引流器 / V 串）
 *  同步上抬同样的 0.55m，合闸仍能插入引流器 */
const JUMPER_LIFT = 0.55;
const CLAMP_POS = new THREE.Vector3(12.5, -26.45 + JUMPER_LIFT, 0);
const CLAMP_ORIGIN = new THREE.Vector3(0, -212.5, 0);
/** 六爪环心半径 470mm，缩放后与半径 0.38m 的六分裂导线一致 */
const CLAMP_SCALE = 0.0008;
/** 实物间隔棒：六臂线夹中心半径 ≈455mm，缩放后正好抓住半径 0.38m 的六分裂导线；
 *  模型自身已按六臂中心居中（原点即六臂中心），无需补偿 */
const SPACER_SCALE = 0.00083;

/** 保护罩：罩体高度 0.85m（缩放 1.1），抽屉口在罩体上部（局部 +Z 面，旋转后朝 +X 对着传动机构）。
 *  罩顶平面直接贴横担底部，整体向塔身移动，罩住加长后的导电杆端部与融冰锁 */
const PROTECTOR_SCALE = 1.1;
const PROTECTOR_HEIGHT = 0.85 * PROTECTOR_SCALE;
/** 罩顶板外表面距罩底 0.800m、内表面 0.795m（实测顶板 5mm 厚），缩放后内表面高出罩底 0.8745m。
 *  罩底又落在 ARM_BOT_Y - 0.935m 处，因此顶板内表面在横担下弦底面以下 0.0605m */
const PROTECTOR_TOP_INNER_Y = ARM_BOT_Y - PROTECTOR_HEIGHT + 0.795 * PROTECTOR_SCALE;

/** 融冰锁：上下镜像后安装在导电杆分闸位置的端部（镜像后模型原点即锁体顶面）。
 *  X 由端部环推出后再向传动机构方向移一个杆径（锁舌轴线正好穿过环孔中心）；
 *  Y 从罩顶板内表面再下移 1.75 个杆径（1.5 + 0.25），锁体完全落在罩内、锁顶与罩顶之间留出间隙；
 *  Z 与保护罩一起随导电杆左移 2 个杆径，再单独左移一个杆径，锁口仍跨在端部环上 */
const LOCK_POS = new THREE.Vector3(
  ICE_PIVOT.x + ROD_TIP_LOCAL + RING_ROD_DY + ROD_DIAMETER,
  PROTECTOR_TOP_INNER_Y - 1.75 * ROD_DIAMETER,
  ICE_PIVOT.z + ROD_Z_SHIFT + ICE_Z_SHIFT + ROD_DIAMETER,
);
/** 融冰锁推杆（锁舌）在锁体内部伸缩的行程：开锁时完全缩回锁体内，露出整个缺口 */
const LOCK_PIN_TRAVEL = 0.34;

/** 罩体后壁（-X 面）正好贴塔身面，加长后的导电杆端部从 +X 抽屉口伸进罩内。
 *  罩腔中心原偏 +Z 0.245m，整体向 -Z 平移后与导电杆所在平面 z=0 对齐；
 *  再向传动机构方向（+X）移一个杆径，与融冰锁一起贴向传动机构 */
const PROTECTOR_POS = new THREE.Vector3(
  2.62 + ROD_DIAMETER,
  ARM_BOT_Y - PROTECTOR_HEIGHT,
  -0.165 + ICE_Z_SHIFT,
);

/** 接地刀闸：坐落在塔底 +Z 面横向安装角钢的顶面，避免与塔腿穿模。
 *  绝缘子轴线在模型 +X 0.30m 处，整体向内（-X）移动 0.67m 后离开塔腿角钢内缘 */
const GROUND_SHELF_Y = -54.45;
const GROUND_SHELF_Z = 6.12;
const GROUND_POS = new THREE.Vector3(5.15, GROUND_SHELF_Y + 0.32, GROUND_SHELF_Z);
const GROUND_SCALE = 0.0015;
/** 闸刀绕铰接销轴（模型原始 mm：x 30 / y -194 / z -80）开合，合闸约 -62°；
 *  模型自带姿态为分闸；鼓轮随后面的连杆同步转动 */
const GROUND_HINGE = new THREE.Vector3(30, -194, -80);
const GROUND_BLADE_CLOSED = -1.08;
const GROUND_DRUM_TURN = 1.15;
const GROUND_DRUM_CENTER = new THREE.Vector3(0, -145, 163.5);

/* 选相刀闸：两根绝缘支柱沿线路方向（Z）并排立在塔底角钢上，顶部用一根水平闸刀相连。
 *  闸刀一端铰接在前侧支柱顶部（转轴竖直），另一端在水平面内旋转：0° 搭上后侧支柱顶部即合闸，
 *  旋转 90° 分开即分闸 */
const PHASE_Z = GROUND_SHELF_Z;
const PHASE_X = 2.4;
const PHASE_SPAN = 0.34;
const PHASE_BASE_Y = GROUND_SHELF_Y + 0.03;
const PHASE_INS_H = 0.62;
const PHASE_BLADE_Y = PHASE_BASE_Y + PHASE_INS_H + 0.035;
/** 模型绝缘子上方的两个接线螺栓（模型原始 mm，绕 Y 轴 -90° 后落到塔上） */
const GROUND_BOLTS: Array<[number, number, number]> = [
  [14, 198.4, -265],
  [49, 198.4, -265],
];
/** 模型局部 → 世界：绕 Y 轴 -90° 再缩放平移 */
const groundWorld = (p: [number, number, number]) =>
  new THREE.Vector3(-p[2], p[1], p[0]).multiplyScalar(GROUND_SCALE).add(GROUND_POS);
/** 两个接线螺栓的世界坐标与其中点（引流导线末端接在此处） */
const GROUND_BOLT_WORLD = GROUND_BOLTS.map(groundWorld);
const GROUND_TERMINAL = GROUND_BOLT_WORLD[0]
  .clone()
  .add(GROUND_BOLT_WORLD[1])
  .multiplyScalar(0.5)
  .add(new THREE.Vector3(0, 0.012, 0));

/** 引流导线：贴着最近的（+X/+Z）塔腿一路向下，再向内接接地刀闸 */
const DRAIN_SUPPORTS = [-9, -15.5, -22, -28.5, -35, -41.5, -48];
const drainLegX = (y: number) => bodyHalf(y) + DRAIN_CORNER_GAP;
const drainLegZ = (y: number) => bodyHalf(y) + DRAIN_OFFSET;

const COLOR_INITIAL = '#4ade80';
const COLOR_ICE = '#f87171';
const COLOR_MOVING = '#fbbf24';

const MOVING_TO_SETTLED: Partial<Record<DeviceState, DeviceState>> = {
  closing: 'closed',
  opening: 'open',
  locking: 'locked',
  unlocking: 'unlocked',
};
const settle = (state: DeviceState | undefined) =>
  state ? (MOVING_TO_SETTLED[state] ?? state) : undefined;
const isMoving = (state: DeviceState | undefined) =>
  state !== undefined && MOVING_TO_SETTLED[state] !== undefined;

function colorOf(module: ModuleDto, kind: DeviceKind): string {
  const state = module.states[kind];
  if (isMoving(state)) return COLOR_MOVING;
  return settle(state) === DEVICE_META[kind].ice ? COLOR_ICE : COLOR_INITIAL;
}

export type TowerTheme = 'dark' | 'light';

export interface TowerOptions {
  onToggle: (kind: DeviceKind) => void;
  /** 融冰刀闸（导电杆）动作时长 */
  animIceSec: number;
  /** 接地刀闸 / 选相刀闸动作时长 */
  animSwitchSec: number;
  /** 融冰锁动作时长 */
  animLockSec: number;
  theme: TowerTheme;
}

/** 快捷视角：全景、跳线（含引流器）、各设备特写 */
export type TowerViewKey =
  | 'overview'
  | 'mid'
  | 'jumper'
  | 'ground1'
  | 'ground2'
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'iceSwitch'
  | 'iceLock';

const VIEW_PRESETS: Record<
  TowerViewKey,
  { position: [number, number, number]; target: [number, number, number] }
> = {
  overview: { position: [62, -6, 132], target: [0, -33, 0] },
  /* 中景：从横担下方微仰视，右侧重点看融冰刀闸、融冰锁与跳线串 / 引流器 */
  mid: { position: [15.6, -19.4, 27.5], target: [8.2, -16.5, 0.3] },
  /* 融冰刀闸：机位退到横担外侧斜下方，整根导电杆（传动端 → 保护罩端）与下方引流器同时入画 */
  iceSwitch: { position: [24, -20, 16], target: [9.5, -20.5, 0.3] },
  /* 融冰锁：机位压在横担下方（不能高于下弦，否则被横担挡住），从正前方（罩口 +X 面）贴近看，
   *  略带 -Z 侧偏角，抽屉里的锁与下方导电杆端部同时落在画面内 */
  iceLock: { position: [4.6, -15.35, -1.02], target: [2.7, -15.42, -0.15] },
  /* 跳线 / 引流器：机位更低更强仰视，目标略抬高让画面下移、露出更多导电杆 */
  jumper: { position: [16.6, -30.2, 6.6], target: [12.4, -25.4 + JUMPER_LIFT, 0.3] },
  phase1: { position: [4.2, -53.3, 9.7], target: [2.4, -54.3, 6.12] },
  phase2: { position: [-4.2, -53.3, 9.7], target: [-2.4, -54.3, 6.12] },
  /* 选相 3：安装在两根选相支柱中间，机位略偏 +X，能看到前后两根绝缘支柱 */
  phase3: { position: [1.2, -53.3, 9.7], target: [0, -54.3, 6.12] },
  ground1: { position: [9.8, -52.7, 10.2], target: [5.3, -54.05, 6.12] },
  ground2: { position: [-9.8, -52.7, 10.2], target: [-5.3, -54.05, 6.12] },
};

export interface TowerHandle {
  setModule(module: ModuleDto): void;
  flyTo(view: TowerViewKey): void;
  /** 调试用：直接指定相机位置与目标点（毫秒级立即生效） */
  setCamera(position: [number, number, number], target: [number, number, number]): void;
  /** 左键拖动切换为平移（便于把任意部位拖到画面中心再放大） */
  setPanMode(on: boolean): void;
  /** 明亮模式下整体压暗材质，避免浅色模型在浅色底上看不清 */
  setTheme(theme: TowerTheme): void;
  dispose(): void;
}

/* ---------------------------- 模型加载 ---------------------------- */

interface ModelDef {
  url: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  kind?: DeviceKind;
  /** 实物模型统一染成鲜明色，便于在塔架中辨认 */
  color: string;
  /** 只保留包围盒中心落在该 Y 区间（模型原始 mm）内的网格 */
  filterY?: [number, number];
  /** 剔除包围盒中心落在该 X 区间（模型原始 mm）内的网格：模型自带的整串多余绝缘子 */
  excludeX?: [number, number];
  /** 剔除包围盒中心落在该立方体（模型原始 mm）内的网格：模型自带的多余抱箍 */
  dropCenter?: Array<{ x: [number, number]; y: [number, number]; z: [number, number] }>;
  /** 上下镜像（实物模型的朝向与塔上安装方式相反） */
  mirrorY?: boolean;
  /** 大块安装板保持钢构色，避免整片强调色 */
  plateColor?: string;
  /** 需要拆出转动部件（接地刀闸的闸刀与鼓轮） */
  rig?: 'ground';
}

const MODEL_DEFS: Record<string, ModelDef> = {
  /* 融冰锁：水平旋转 90°（长轴顺线路方向）+ 上下镜像；
   * 沿线路方向平移，使锁口正对导电杆分闸到位的位置 */
  lock: {
    url: '/models/ice-lock.glb',
    position: [LOCK_POS.x, LOCK_POS.y, LOCK_POS.z],
    rotation: [0, Math.PI / 2, 0],
    mirrorY: true,
    kind: 'iceLock',
    color: '#e6004f',
  },
  /* 引流器：六爪与六根子导线同相位，整体缩放后爪环半径与导线束一致；
   * 模型原点在六爪中心下方 212.5mm，对象位置按缩放上移，使六爪中心落在 CLAMP_POS */
  clamp: {
    url: '/models/drain-clamp.glb',
    position: [
      CLAMP_POS.x,
      CLAMP_POS.y - CLAMP_ORIGIN.y * CLAMP_SCALE,
      CLAMP_POS.z,
    ],
    scale: CLAMP_SCALE,
    color: '#d81f00',
  },
  /* 自动接地刀闸：水平镜像（-90°）使绝缘子靠向 +X 侧塔腿，整体放大一号；
   * 底座抬高到塔底水平角钢顶面之上，避免与塔材融合穿模 */
  ground: {
    url: '/models/auto-ground-switch.glb',
    position: [GROUND_POS.x, GROUND_POS.y, GROUND_POS.z],
    rotation: [0, -Math.PI / 2, 0],
    scale: GROUND_SCALE,
    kind: 'ground1',
    color: '#1a8f00',
    rig: 'ground',
  },
  /* 融冰刀闸驱动部分（电机罩朝上的蘑菇头 + 减速器 + 固定板 + 支撑绝缘子），杆件与远端夹持件已过滤；
   * 输出中心在模型 -X 0.18m 处，正好落在导电杆轴线上。
   * 模型右侧还自带一串竖直长绝缘子（缺陷件），按 X 区间剔除 */
  drive: {
    url: '/models/ice-switch-main.glb',
    position: [12.28, -17.042 + DRIVE_RISE, -0.048],
    kind: 'iceSwitch',
    color: '#e88900',
    filterY: [-1400, 820],
    excludeX: [380, 520],
    /* 模型下部的钟形抱箍（卡在导电杆上的下支撑件）：杆件已单独建模，整件剔除 */
    dropCenter: [{ x: [-170, 130], y: [-1610, -945], z: [-60, 160] }],
    plateColor: '#8b9cb0',
  },
};

const modelCache = new Map<string, Promise<THREE.Group>>();
const gltfLoader = new GLTFLoader();

function loadModel(url: string): Promise<THREE.Group> {
  const cached = modelCache.get(url);
  if (cached) return cached;
  const task = gltfLoader.loadAsync(url).then((gltf) => gltf.scene);
  modelCache.set(url, task);
  return task;
}

function prepareModel(base: THREE.Group, def: ModelDef, materials: THREE.MeshStandardMaterial[]): THREE.Group {
  const clone = base.clone(true);
  /* 先在模型原始坐标（mm）里做网格过滤与染色，再套缩放 / 位置 / 旋转 */
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3();
  clone.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox as THREE.Box3).applyMatrix4(mesh.matrixWorld);
    const size = box.getSize(new THREE.Vector3());
    const centerY = (box.min.y + box.max.y) / 2;
    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    if (def.filterY && (centerY < def.filterY[0] || centerY > def.filterY[1])) {
      mesh.visible = false;
      return;
    }
    if (def.excludeX && centerX > def.excludeX[0] && centerX < def.excludeX[1]) {
      mesh.visible = false;
      return;
    }
    const dropped = def.dropCenter?.some(
      (zone) =>
        centerX > zone.x[0] &&
        centerX < zone.x[1] &&
        centerY > zone.y[0] &&
        centerY < zone.y[1] &&
        centerZ > zone.z[0] &&
        centerZ < zone.z[1],
    );
    if (dropped) {
      mesh.visible = false;
      return;
    }
    /* 大块安装板（顶部固定板）保留钢构色 */
    const isPlate = def.plateColor !== undefined && size.x > 1500 && Math.abs(centerY) < 400;
    const color = isPlate ? (def.plateColor as string) : def.color;
    const material = (mesh.material as THREE.MeshStandardMaterial).clone();
    material.color.set(color);
    material.emissive.set(color);
    material.emissiveIntensity = isPlate ? 0.06 : 0.24;
    material.metalness = isPlate ? 0.4 : 0.28;
    material.roughness = 0.45;
    material.side = THREE.DoubleSide;
    mesh.material = material;
    mesh.userData.kind = def.kind;
    materials.push(material);
  });
  /* 拆转动部件必须在套用根变换之前完成（此时模型仍是原始 mm 坐标） */
  if (def.rig === 'ground') rigGroundSwitch(clone);
  clone.scale.setScalar(def.scale ?? 0.001);
  if (def.mirrorY) clone.scale.y *= -1;
  clone.position.fromArray(def.position);
  if (def.rotation) clone.rotation.set(...def.rotation);
  return clone;
}

/** 接地刀闸：把闸刀与鼓轮从合并网格中拆出来，各自套一个以转轴中心为原点的变换组。
 *  模型原始坐标为 mm，父节点只有平移，故绕 pivot 局部 X 轴旋转即绕世界 X 轴旋转。 */
function rigGroundSwitch(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  let blade: THREE.Mesh | null = null;
  const drum: THREE.Mesh[] = [];
  meshes.forEach((mesh) => {
    mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox as THREE.Box3).applyMatrix4(mesh.matrixWorld);
    box.getSize(size);
    box.getCenter(center);
    if (size.x < 20 && size.y > 280) {
      blade = mesh;
    } else if (size.x < 45 && size.y < 45 && size.z < 50 && center.z > 130) {
      drum.push(mesh);
    }
  });
  const pivotOf = (point: THREE.Vector3, parts: THREE.Mesh[], name: string) => {
    const parent = parts[0].parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.copy(point).applyMatrix4(parent.matrixWorld.clone().invert());
    parent.add(pivot);
    parts.forEach((part) => pivot.attach(part));
  };
  if (blade) pivotOf(GROUND_HINGE, [blade], 'ground-blade');
  if (drum.length > 0) pivotOf(GROUND_DRUM_CENTER, drum, 'ground-drum');
}

/* ---------------------------- 场景构建 ---------------------------- */

export function createTowerView(host: HTMLElement, options: TowerOptions): TowerHandle {
  const width = host.clientWidth || 560;
  const height = host.clientHeight || 420;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  /* 高 DPI 屏上 2 倍渲染代价翻倍，1.5 倍已足够清晰 */
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(34, width / height, 0.06, 900);
  camera.position.fromArray(VIEW_PRESETS.overview.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.fromArray(VIEW_PRESETS.overview.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  /* 平移在屏幕平面内进行，便于把塔顶 / 塔底拖到画面中心后再放大 */
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.minDistance = 0.12;
  controls.maxDistance = 420;
  controls.maxPolarAngle = Math.PI * 0.55;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xdcecff, 0x1a2433, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(60, 40, 90);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x93b6dd, 0.9);
  fill.position.set(-70, -20, -60);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x7dd3fc, 0.55);
  rim.position.set(0, 20, -110);
  scene.add(rim);

  /* ---------- 地面 ---------- */
  const baseRing = new THREE.Mesh(
    new THREE.RingGeometry(9.6, 10.3, 72),
    new THREE.MeshBasicMaterial({ color: 0x2a4462, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  baseRing.rotation.x = -Math.PI / 2;
  baseRing.position.y = BODY_BOTTOM - 0.05;
  scene.add(baseRing);

  const grid = new THREE.GridHelper(90, 36, 0x24405c, 0x172838);
  grid.position.y = BODY_BOTTOM - 0.1;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  scene.add(grid);

  /* ---------- 合并几何缓存 ---------- */
  const buckets = new Map<string, THREE.BufferGeometry[]>();
  const pushGeo = (bucket: string, geo: THREE.BufferGeometry) => {
    const list = buckets.get(bucket) ?? [];
    list.push(geo);
    buckets.set(bucket, list);
  };

  const up = new THREE.Vector3(0, 1, 0);
  const tmpDir = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpMid = new THREE.Vector3();
  const tmpScale = new THREE.Vector3(1, 1, 1);
  const tmpMat = new THREE.Matrix4();

  function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, bucket = 'steel', h = w) {
    tmpDir.subVectors(b, a);
    const length = tmpDir.length();
    if (length < 0.01) return;
    const geo = new THREE.BoxGeometry(w, length, h);
    tmpQuat.setFromUnitVectors(up, tmpDir.normalize());
    tmpMid.addVectors(a, b).multiplyScalar(0.5);
    tmpMat.compose(tmpMid, tmpQuat, tmpScale);
    geo.applyMatrix4(tmpMat);
    pushGeo(bucket, geo);
  }

  function tube(points: THREE.Vector3[], radius: number, bucket: string, segments = 64) {
    if (points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.25);
    pushGeo(bucket, new THREE.TubeGeometry(curve, segments, radius, 7, false));
  }

  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  /* ---------- 六分裂导线 ---------- */
  const BUNDLE_RADIUS = 0.38;
  const BUNDLE_TUBE_RADIUS = 0.022;
  /* 子导线相位取 0° / 60° / …，与引流器六个握爪一一对应（顶部 90° 方向留给引流器开口支架） */
  const HEX_OFFSETS = Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index;
    return new THREE.Vector2(Math.cos(angle) * BUNDLE_RADIUS, Math.sin(angle) * BUNDLE_RADIUS);
  });

  /* 实物间隔棒实例位姿：环面法线（模型 +Z）对齐导线切线，六臂与六根子导线同相位 */
  const spacerSlots: Array<{ position: THREE.Vector3; quaternion: THREE.Quaternion }> = [];

  /** 6 根子导线（沿切线法平面均布）+ 沿线每隔数米一个实物间隔棒。
   *  extraSpanZ：在水平导线上按指定 Z 坐标额外补间隔棒（靠近塔身的分段原本被 skipSpacer 跳过） */
  function bundle(
    points: THREE.Vector3[],
    spacerEvery = 4.2,
    segments = 96,
    skipSpacer?: (position: THREE.Vector3) => boolean,
    extraSpanZ?: number[],
  ) {
    if (points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.25);
    const length = curve.getLength();
    const steps = Math.max(12, Math.round(length * 3));
    const strands: THREE.Vector3[][] = HEX_OFFSETS.map(() => []);
    const sample = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const xAxis = new THREE.Vector3();
    const yAxis = new THREE.Vector3();
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      curve.getPointAt(u, sample);
      curve.getTangentAt(u, tan).normalize();
      /* 世界 X 在法平面内的投影作为 0° 方向，六根子导线与间隔棒六臂同相位 */
      xAxis.set(1, 0, 0).addScaledVector(tan, -tan.x);
      if (xAxis.lengthSq() < 0.02) xAxis.set(0, 1, 0).addScaledVector(tan, -tan.y);
      xAxis.normalize();
      yAxis.crossVectors(tan, xAxis).normalize();
      HEX_OFFSETS.forEach((offset, index) => {
        strands[index].push(sample.clone().addScaledVector(xAxis, offset.x).addScaledVector(yAxis, offset.y));
      });
    }
    strands.forEach((strand) => tube(strand, BUNDLE_TUBE_RADIUS, 'conductor', segments));
    const count = Math.max(1, Math.floor(length / spacerEvery));
    const basis = new THREE.Matrix4();
    for (let i = 1; i < count; i += 1) {
      const u = i / count;
      const position = curve.getPointAt(u);
      if (skipSpacer && skipSpacer(position)) continue;
      curve.getTangentAt(u, tan).normalize();
      xAxis.set(1, 0, 0).addScaledVector(tan, -tan.x);
      if (xAxis.lengthSq() < 0.02) xAxis.set(0, 1, 0).addScaledVector(tan, -tan.y);
      xAxis.normalize();
      yAxis.crossVectors(tan, xAxis).normalize();
      xAxis.crossVectors(yAxis, tan).normalize();
      basis.makeBasis(xAxis, yAxis, tan);
      spacerSlots.push({
        position,
        quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
      });
    }
    /* 靠近塔身的分段按指定 Z 坐标补间隔棒：在曲线上找最接近的点，
     *  仍用同一套法平面基向量，保证六爪与六根子导线同相位 */
    if (extraSpanZ) {
      const probe = new THREE.Vector3();
      const fine = Math.max(200, steps * 2);
      extraSpanZ.forEach((zTarget) => {
        let bestU = -1;
        let bestDist = Infinity;
        for (let s = 0; s <= fine; s += 1) {
          const u = s / fine;
          curve.getPointAt(u, probe);
          const dist = Math.abs(probe.z - zTarget);
          if (dist < bestDist) {
            bestDist = dist;
            bestU = u;
          }
        }
        if (bestU < 0) return;
        const position = curve.getPointAt(bestU);
        curve.getTangentAt(bestU, tan).normalize();
        xAxis.set(1, 0, 0).addScaledVector(tan, -tan.x);
        if (xAxis.lengthSq() < 0.02) xAxis.set(0, 1, 0).addScaledVector(tan, -tan.y);
        xAxis.normalize();
        yAxis.crossVectors(tan, xAxis).normalize();
        xAxis.crossVectors(yAxis, tan).normalize();
        basis.makeBasis(xAxis, yAxis, tan);
        spacerSlots.push({
          position,
          quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
        });
      });
    }
  }

  /* ---------- 塔身 / 横担 / 塔顶 ----------
   * 整体使用实物塔模型 tension-tower.glb（复刻横担、塔顶三角与全部连接金具），
   * 此处只补充设备安装件与外挂导线。 ---------- */

  /* V 形跳线串挂点处的下弦横向横撑：把 V 串上端真正挂到横担下弦上 */
  const V_LEG_SPAN = 6.68;
  [-1, 1].forEach((side) => {
    [12.5 - V_LEG_SPAN, 12.5 + V_LEG_SPAN].forEach((hx) => {
      beam(V(side * hx, armBotY(), -ARM_BOT_Z), V(side * hx, armBotY(), ARM_BOT_Z), 0.09);
    });
  });


  /* 横担上方的三角斜角钢（塔身外侧的三角撑板，底边在 y≈-12.4）与横担上弦之间悬空：
   * 模型里上弦在 x≈2.6~5.5 缺了一段。把缺失的上弦补齐（内端一直伸到塔身外表面，
   * 与塔身接触，不再悬空），并在撑板底下加竖向填板焊死 */
  [-1, 1].forEach((side) => {
    [-1, 1].forEach((sz) => {
      beam(V(side * 1.5, -12.73, sz * 1.7), V(side * 5.75, -12.73, sz * 1.7), 0.12, 'steel', 0.3);
      beam(V(side * 2.4, -12.38, sz * 1.65), V(side * 2.4, -12.85, sz * 1.65), 0.1, 'steel', 0.18);
    });
  });

  /* ---------- 融冰刀闸传动机构与保护罩：顶板 / 罩顶平面直接贴横担底部，
   * 不再用角钢吊板把它们悬在横担下面 ---------- */

  /* ---------- 塔底安装平台：横跨 +Z 面的安装角钢，两端插入两侧塔腿 ----------
   * 接地刀闸与选相刀闸都坐在角钢顶面（y = GROUND_SHELF_Y），不再悬空 */
  beam(
    V(-6.16, GROUND_SHELF_Y - 0.08, GROUND_SHELF_Z),
    V(6.16, GROUND_SHELF_Y - 0.08, GROUND_SHELF_Z),
    0.08,
    'steel',
    0.16,
  );
  /* 选相刀闸的底座板与绝缘支柱在下方“实物模型”段统一构建（闸刀需要独立旋转） */

  /* ---------- 地线（沿线路方向，接在塔顶地线支架端部） ---------- */
  [-1, 1].forEach((side) => {
    tube([V(side * PEAK_X, PEAK_Y, -38), V(side * PEAK_X, PEAK_Y, 0), V(side * PEAK_X, PEAK_Y, 38)], 0.045, 'groundWire', 12);
  });

  /* ---------- 引流导线（地线 → 贴塔顶斜角钢下行 → 沿 +X/+Z 塔腿外侧引下 → 接地刀闸） ----------
   * 顶部斜段与横担下方的斜角钢平行：角钢实测顶面 y = -3.8 + 0.30·(x-2)、z = 1.42 - 0.022·x，
   * 导线中心取角钢下方 0.42m，与角钢保持固定间距，不再外飘 */
  const topSteelY = (x: number) => -3.8 + 0.3 * (x - 2);
  const topSteelZ = (x: number) => 1.42 - 0.022 * x;
  const topWire = (x: number) => V(x, topSteelY(x) - 0.42, topSteelZ(x));
  const drainPoints: THREE.Vector3[] = [
    V(PEAK_X, PEAK_Y, 0.12),
    topWire(14.3),
    topWire(12.5),
    topWire(10.5),
    topWire(8.5),
    topWire(6.5),
    topWire(4.5),
    topWire(3.0),
    topWire(2.4),
    V(drainLegX(-5.2), -5.2, drainLegZ(-5.2) - 0.06),
    V(drainLegX(-6), -6, drainLegZ(-6)),
  ];
  [-9, -13, -17.5, -22, -26.5, -31, -35.5, -40, -44.5, -49, -52.5].forEach((y) => {
    drainPoints.push(V(drainLegX(y), y, drainLegZ(y)));
  });
  /* 经过最下面的一个绝缘子后顺着塔腿外侧内收，平缓地弯到接地刀闸绝缘子上方的两个接线螺栓，
   * 不再向外甩出再折回来 */
  drainPoints.push(
    V(5.92, -52.85, 6.245),
    V(5.78, -53.18, 6.215),
    V(5.64, -53.48, 6.18),
    GROUND_TERMINAL.clone(),
  );
  tube(drainPoints, 0.026, 'drain', 180);
  /* 两个接线螺栓之间跨一根小连接板，引流导线末端落在板中点 */
  beam(GROUND_BOLT_WORLD[0], GROUND_BOLT_WORLD[1], 0.05, 'hardware');

  /* 引流线绝缘子（实物模型）：Z 型卡端贴塔腿，带孔卡箍端接引流导线。
   * 绝缘子长度随引下线与塔腿的间距缩放，一端卡在塔腿外侧面、一端箍住导线 */
  interface Standoff {
    position: THREE.Vector3;
    rotation: [number, number, number];
    scale: number;
  }
  const standoffs: Standoff[] = [];
  const STANDOFF_LEN = 0.636;
  DRAIN_SUPPORTS.forEach((y) => {
    const h = bodyHalf(y);
    /* 卡端正好落在塔身外表面上，卡箍端在 DRAIN_OFFSET 处抱住导线 */
    const length = DRAIN_OFFSET - DRAIN_LEG_FACE;
    standoffs.push({
      position: V(drainLegX(y), y, h + DRAIN_LEG_FACE + length / 2),
      rotation: [-Math.PI / 2, 0, 0],
      scale: length / STANDOFF_LEN,
    });
  });
  /* 顶部斜段的两个支撑：竖直立在斜角钢下方，卡端（模型 +Y 端）压在角钢顶面、
   *  卡箍端抱住下方 0.42m 处的引流导线，不再横向悬空 */
  [7.55, 4.05].forEach((x) => {
    const steelY = topSteelY(x);
    const wireY = steelY - 0.42;
    const top = steelY + 0.02;
    const length = top - wireY;
    standoffs.push({
      position: V(x, (top + wireY) / 2, topSteelZ(x)),
      rotation: [0, 0, 0],
      scale: length / STANDOFF_LEN,
    });
  });

  /* ---------- 分支引流线：从主引流线高处引出，越过横担上方的三角斜角钢，
   *  沿横担顶面之上跨过去，再在传动机构前方折下、自上而下接入减速器旁的小绝缘子 ---------- */
  const branchPoints: THREE.Vector3[] = [
    V(drainLegX(-11.4), -11.4, drainLegZ(-11.4)),
    V(2.35, -11.5, 1.35),
    V(3.4, -11.68, 0.1),
    V(4.8, -11.8, -1.0),
    V(6.8, -11.88, -1.65),
    V(9.2, -11.9, -1.65),
    V(11.2, -12.05, -1.7),
    V(11.78, -13.1, -1.05),
    V(11.86, -14.7, -0.68),
    V(11.79, -15.6, -0.5),
    V(11.76, -15.97, -0.42),
  ];
  tube(branchPoints, 0.022, 'drain', 140);
  /* 分支引流线的两只支撑绝缘子：竖向立在横担上弦顶面（y = -12.7）上，
   * 卡箍端抱住上方的分支线、卡端压在上弦顶面（模型 +Y 端为卡端，需上下翻转 180°） */
  [
    { x: 6.8, z: -1.65, top: -11.88 },
    { x: 9.2, z: -1.65, top: -11.9 },
  ].forEach((entry) => {
    /* 上弦顶面 y = -12.7（板面 -12.7~-12.75），卡端再嵌入 5cm 确保与弦杆贴实 */
    const bottom = armBotY() + 2.27;
    const length = entry.top - bottom;
    standoffs.push({
      position: V(entry.x, (entry.top + bottom) / 2, entry.z),
      rotation: [Math.PI, 0, 0],
      scale: length / STANDOFF_LEN,
    });
  });

  /* ---------- 极线耐张串：实物三串模型（含均压环与两端连接金具） ----------
   *  三串沿横担方向并排，串长方向沿线路水平拉出；均压环一端（导线端）固定不动，
   *  塔端略向上仰并加长，使三串塔端正好搭在横担边缘的三对带孔连接板上 */
  const TENSION_X = 11.2;
  const TENSION_Y = -15.33;
  const TENSION_NEAR_Z = 2.0;
  const TENSION_FAR_Z = 13.6;
  /** 塔端上仰角度（rad）：环端固定，塔端上翘约 0.14m 贴到连接板底面 */
  const TENSION_TILT = 0.0125;
  const tensionSlots: Array<{ side: number; dir: number }> = [];
  [-1, 1].forEach((side) => {
    [-1, 1].forEach((dir) => {
      tensionSlots.push({ side, dir });
    });
  });

  /* ---------- 跳线：从一侧极线水平段弯下来，绕成沿线路方向的水平环，再弯回另一侧极线。
   *  引流器所在的一段跳线捋直并适当拉长，供鼠笼管与抱箍间隔棒贴合 ---------- */
  const JUMPER_Y = -26.45 + JUMPER_LIFT;
  const CAGE_HALF = 8.4;
  [-1, 1].forEach((side) => {
    const x = side * 12.5;
    const xEnd = side * TENSION_X;
    bundle(
      [
        V(xEnd, TENSION_Y, 42),
        V(xEnd, TENSION_Y, 26),
        V(xEnd, TENSION_Y, 13.6),
        V(x, -20.3 + JUMPER_LIFT, 11.4),
        V(x, -25.2 + JUMPER_LIFT, 9.6),
        V(x, JUMPER_Y, CAGE_HALF),
        V(x, JUMPER_Y, 0),
        V(x, JUMPER_Y, -CAGE_HALF),
        V(x, -25.2 + JUMPER_LIFT, -9.6),
        V(x, -20.3 + JUMPER_LIFT, -11.4),
        V(xEnd, TENSION_Y, -13.6),
        V(xEnd, TENSION_Y, -26),
        V(xEnd, TENSION_Y, -42),
      ],
      4.4,
      220,
      /* 跳线环（y ≤ -24，含鼠笼管段）上的普通圆形间隔棒删掉，该段由抱箍间隔棒负责；
       *  水平导线上靠近耐张串均压环、与导线对不上且表面锯齿的三个（|z| ≈ 15~24）删掉；
       *  水平段外侧与导线契合良好、形态圆润的三个（|z| ≈ 28~38）以及跳线弯折处的几个都保留 */
      (position) =>
        position.y <= -24 ||
        (Math.abs(position.z) > 14 && Math.abs(position.z) < 26),
      /* 靠近塔身的水平段（|z| 13.6~26）原本没有间隔棒：按等间距补三个，
       *  与远离塔身那三个同型号、同缩放，位姿取自同一条导线的曲线 */
      [16.7, 19.8, 22.9, -16.7, -19.8, -22.9],
    );
  });

  /* ---------- 跳线串（V 形长悬垂绝缘子串，上端挂在横担下弦，单腿长 ≈ 10.69m） ---------- */
  const strings: Array<{ top: THREE.Vector3; bottom: THREE.Vector3 }> = [];
  [-1, 1].forEach((side) => {
    [-1, 1].forEach((dir) => {
      const z = dir * 1.0;
      const bottom = V(side * 12.5, -25.3 + JUMPER_LIFT, z);
      [12.5 - V_LEG_SPAN, 12.5 + V_LEG_SPAN].forEach((topX) => {
        strings.push({ top: V(side * topX, armBotY(), z), bottom });
      });
      /* 线夹接到跳线上，避免 V 串悬空 */
      beam(bottom, V(side * 12.5, -26.42 + JUMPER_LIFT, z), 0.09, 'hardware');
    });
  });

  /* ---------- 合并生成网格 ---------- */
  const materialOf = (bucket: string): THREE.MeshStandardMaterial => {
    switch (bucket) {
      case 'insulator':
        return new THREE.MeshStandardMaterial({ color: 0x6e4a3a, metalness: 0.15, roughness: 0.75 });
      case 'conductor':
        return new THREE.MeshStandardMaterial({ color: 0xc4d0dd, metalness: 0.6, roughness: 0.38 });
      case 'groundWire':
        return new THREE.MeshStandardMaterial({ color: 0x9aa7b6, metalness: 0.6, roughness: 0.4 });
      case 'hardware':
        return new THREE.MeshStandardMaterial({ color: 0xdde6f2, metalness: 0.65, roughness: 0.32 });
      case 'drain':
        return new THREE.MeshStandardMaterial({ color: 0xb4603f, metalness: 0.35, roughness: 0.55 });
      default:
        return new THREE.MeshStandardMaterial({ color: 0x8b9cb0, metalness: 0.38, roughness: 0.55 });
    }
  };

  const towerGroup = new THREE.Group();
  scene.add(towerGroup);
  buckets.forEach((geos, bucket) => {
    const merged = mergeGeometries(geos, false);
    geos.forEach((geo) => geo.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, materialOf(bucket));
    mesh.name = `tower-${bucket}`;
    towerGroup.add(mesh);
  });

  /* ---------- 塔身实物模型（复刻横担、塔顶三角、地线支架与全部挂点金具） ---------- */
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0x8b9cb0,
    metalness: 0.38,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
  loadModel('/models/tension-tower.glb')
    .then((base) => {
      const tower = base.clone(true);
      tower.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = towerMat;
      });
      towerGroup.add(tower);
      applyThemeTint();
    })
    .catch(() => {
      /* 资源缺失时保留补强件 */
    });


  /* ---------- 融冰刀闸导电杆 ---------- */
  const rodGroup = new THREE.Group();
  rodGroup.position.copy(ICE_PIVOT);
  rodGroup.position.z += ROD_Z_SHIFT;
  scene.add(rodGroup);

  /* 导电杆只比导线略粗；杆端不再放大球 */
  const rodMat = new THREE.MeshStandardMaterial({
    color: 0x00708c,
    emissive: new THREE.Color(0x003845),
    emissiveIntensity: 0.35,
    metalness: 0.32,
    roughness: 0.42,
  });
  /* 导电杆为一根贯通整根的缓锥：上端略粗，直接套进减速器端部连接板的圆柱筒；
   * 末端收细中途不变径，正好插入引流器抱箍的通孔（不再有单独的两头等径圆柱段） */
  const rodBody = new THREE.Mesh(
    new THREE.CylinderGeometry(ROD_TOP_RADIUS, ROD_TIP_RADIUS, ICE_ROD_LEN, 24),
    rodMat,
  );
  rodBody.position.y = (ROD_TOP_LOCAL + ROD_TIP_LOCAL) / 2;
  rodBody.userData.kind = 'iceSwitch' satisfies DeviceKind;
  rodGroup.add(rodBody);

  const rodProxy = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, ICE_ROD_LEN, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  rodProxy.position.y = (ROD_TOP_LOCAL + ROD_TIP_LOCAL) / 2;
  rodProxy.userData.kind = 'iceSwitch' satisfies DeviceKind;
  rodGroup.add(rodProxy);

  /* ---------- 设备状态指示球 ---------- */
  const indicators: Partial<Record<DeviceKind, THREE.MeshStandardMaterial>> = {};
  /* 状态色球与点击热区：选相 3 只在 MG500 上存在，日后再由 applyVisuals 按模块设备表显隐 */
  const indicatorMeshes: Partial<Record<DeviceKind, THREE.Mesh>> = {};
  const indicatorHits: Partial<Record<DeviceKind, THREE.Mesh>> = {};
  /* 状态色球会随状态改色，不参与明亮模式压暗，否则主题切换会把颜色改回去 */
  const indicatorMats = new Set<THREE.MeshStandardMaterial>();
  const addIndicator = (
    kind: DeviceKind,
    position: THREE.Vector3,
    hitRadius = 1.3,
    visible = true,
    radius = 0.2,
  ) => {
    if (visible) {
      const material = new THREE.MeshStandardMaterial({
        color: COLOR_INITIAL,
        emissive: new THREE.Color(COLOR_INITIAL),
        emissiveIntensity: 0.9,
        metalness: 0.2,
        roughness: 0.4,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), material);
      mesh.position.copy(position);
      mesh.userData.kind = kind;
      scene.add(mesh);
      indicators[kind] = material;
      indicatorMeshes[kind] = mesh;
      indicatorMats.add(material);
    }
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(hitRadius, 10, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hit.position.copy(position);
    hit.userData.kind = kind;
    indicatorHits[kind] = hit;
    scene.add(hit);
  };
  /* 选相刀闸与接地刀闸同在塔底第一个水平角钢平面，指示球浮在顶部闸刀上方 */
  addIndicator('phase1', V(PHASE_X, PHASE_BLADE_Y + 0.12, PHASE_Z), 1.0, true, 0.09);
  addIndicator('phase2', V(-PHASE_X, PHASE_BLADE_Y + 0.12, PHASE_Z), 1.0, true, 0.09);
  addIndicator('phase3', V(0, PHASE_BLADE_Y + 0.12, PHASE_Z), 1.0, true, 0.09);
  /* 接地刀闸已有实物模型（模型网格本身带点击目标），锚点对齐绝缘子上方的接线螺栓 */
  addIndicator('ground1', GROUND_TERMINAL.clone(), 1.3, false);

  /* ---------- 设备标签：HTML 叠加层，按 3D 位置投影，点击即切换 ---------- */
  const tagLayer = document.createElement('div');
  tagLayer.className = 'tower-tags';
  host.appendChild(tagLayer);

  interface TagEntry {
    kind: DeviceKind;
    el: HTMLButtonElement;
    anchor: THREE.Vector3;
    offset: [number, number];
  }
  const TAG_DEFS: Array<{ kind: DeviceKind; label: string; anchor: THREE.Vector3; offset: [number, number] }> = [
    { kind: 'iceSwitch', label: '融冰刀闸', anchor: V(12.3, -17.45 + DRIVE_RISE, 0), offset: [40, 10] },
    { kind: 'iceLock', label: '融冰锁', anchor: V(LOCK_POS.x, LOCK_POS.y, 0.1), offset: [0, 18] },
    { kind: 'ground1', label: '接地刀闸', anchor: GROUND_TERMINAL.clone(), offset: [0, -46] },
    { kind: 'phase1', label: '选相 1', anchor: V(PHASE_X, PHASE_BLADE_Y + 0.12, PHASE_Z), offset: [0, -34] },
    { kind: 'phase2', label: '选相 2', anchor: V(-PHASE_X, PHASE_BLADE_Y + 0.12, PHASE_Z), offset: [0, -34] },
    { kind: 'phase3', label: '选相 3', anchor: V(0, PHASE_BLADE_Y + 0.12, PHASE_Z), offset: [0, -34] },
  ];
  const tags: TagEntry[] = TAG_DEFS.map((def) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tower-tag';
    el.textContent = def.label;
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      options.onToggle(def.kind);
    });
    tagLayer.appendChild(el);
    return { kind: def.kind, el, anchor: def.anchor, offset: def.offset };
  });

  /* ---------- 实物模型（STEP → GLB） ---------- */
  const deviceMaterials: THREE.MeshStandardMaterial[] = [];
  const lockMaterials: THREE.MeshStandardMaterial[] = [];
  /* 融冰锁电机推杆：随锁止 / 解锁沿自身轴向伸缩 */
  let lockPush: THREE.Mesh | null = null;
  /* 接地刀闸：闸刀 / 鼓轮转轴组，progress 0 = 分闸，1 = 合闸 */
  let groundRig: { blade: THREE.Object3D; drum: THREE.Object3D } | null = null;
  let groundProgress = 0;
  let groundFrom = 0;
  let groundTo = 0;
  let groundAnimStart = 0;
  let groundAnimDuration = 0;
  let groundPrimed = false;
  const modelTasks: Promise<void>[] = [];
  Object.entries(MODEL_DEFS).forEach(([name, def]) => {
    modelTasks.push(
      loadModel(def.url)
        .then((base) => {
          const object = prepareModel(base, def, deviceMaterials);
          scene.add(object);
          if (name === 'lock') {
            object.traverse((child) => {
              const mesh = child as THREE.Mesh;
              if (!mesh.isMesh) return;
              lockMaterials.push(mesh.material as THREE.MeshStandardMaterial);
              mesh.geometry.computeBoundingBox();
              const box = mesh.geometry.boundingBox;
              if (!box) return;
              const size = box.getSize(new THREE.Vector3());
              if (size.x > 280 && size.x < 340 && size.y < 40 && size.z < 40) lockPush = mesh;
            });
          }
          if (name === 'ground') {
            const blade = object.getObjectByName('ground-blade');
            const drum = object.getObjectByName('ground-drum');
            if (blade && drum) {
              groundRig = { blade, drum };
              blade.rotation.x = GROUND_BLADE_CLOSED * groundProgress;
              drum.rotation.x = GROUND_DRUM_TURN * groundProgress;
            }
          }
          requestRender();
        })
        .catch(() => {
          /* 资源缺失时保持其余塔体可用 */
        }),
    );
  });

  /* ---------- 选相刀闸：两根绝缘支柱 + 顶部水平闸刀（绕一端竖直轴旋转） ----------
   *  两根绝缘子沿线路方向（Z）立在塔底角钢上，闸刀铰接在前侧支柱顶部：
   *  合闸时刀身搭到后侧支柱顶部，分闸时在水平面内转过 90° 分开 */
  const phaseInsulatorMat = new THREE.MeshStandardMaterial({ color: 0x6e4a3a, metalness: 0.15, roughness: 0.75 });
  const phaseSteelMat = new THREE.MeshStandardMaterial({ color: 0xdde6f2, metalness: 0.65, roughness: 0.32 });
  deviceMaterials.push(phaseInsulatorMat, phaseSteelMat);
  interface BladeRig {
    /** 整组模型：MG400 只有两组选相刀闸，缺 phase3 时整组隐藏 */
    group: THREE.Object3D;
    pivot: THREE.Object3D;
    /** 分闸旋转方向：+1 向 +X 摆开，-1 向 -X 摆开 */
    sign: number;
    /** 1 = 合闸（搭在另一根绝缘子顶部），0 = 分闸（转过 90°） */
    progress: number;
    from: number;
    to: number;
    start: number;
    duration: number;
    primed: boolean;
  }
  const phaseBlades = new Map<DeviceKind, BladeRig>();

  const addPhaseSwitch = (kind: DeviceKind, x: number) => {
    const sign = x >= 0 ? 1 : -1;
    const group = new THREE.Group();
    /* 底座板 */
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 2 * PHASE_SPAN + 0.26), phaseSteelMat);
    plate.position.set(x, PHASE_BASE_Y - 0.025, PHASE_Z);
    group.add(plate);
    /* 两根绝缘支柱（柱身 + 伞裙）与顶部接线夹 */
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, PHASE_INS_H, 12);
    const shedGeo = new THREE.CylinderGeometry(0.105, 0.105, 0.016, 14);
    [-1, 1].forEach((dz) => {
      const post = new THREE.Mesh(postGeo, phaseInsulatorMat);
      post.position.set(x, PHASE_BASE_Y + PHASE_INS_H / 2, PHASE_Z + dz * PHASE_SPAN);
      group.add(post);
      for (let i = 0; i < 6; i += 1) {
        const shed = new THREE.Mesh(shedGeo, phaseInsulatorMat);
        shed.position.set(x, PHASE_BASE_Y + 0.1 + (i / 5) * (PHASE_INS_H - 0.14), PHASE_Z + dz * PHASE_SPAN);
        group.add(shed);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.11), phaseSteelMat);
      cap.position.set(x, PHASE_BASE_Y + PHASE_INS_H + 0.02, PHASE_Z + dz * PHASE_SPAN);
      group.add(cap);
    });
    /* 闸刀：铰接在 -Z 侧支柱顶部，刀身沿 +Z 伸向另一根支柱 */
    const pivot = new THREE.Group();
    pivot.position.set(x, PHASE_BLADE_Y, PHASE_Z - PHASE_SPAN);
    const bladeGeo = new THREE.BoxGeometry(0.05, 0.05, 2 * PHASE_SPAN);
    bladeGeo.translate(0, 0, PHASE_SPAN);
    pivot.add(new THREE.Mesh(bladeGeo, phaseSteelMat));
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 10), phaseSteelMat);
    pivot.add(pin);
    group.add(pivot);
    scene.add(group);
    phaseBlades.set(kind, { group, pivot, sign, progress: 0, from: 0, to: 0, start: 0, duration: 0, primed: false });
  };
  addPhaseSwitch('phase1', PHASE_X);
  addPhaseSwitch('phase2', -PHASE_X);
  /* 选相 3：MG500 的第三相，居中安装在两根选相支柱之间 */
  addPhaseSwitch('phase3', 0);

  /* ---------- 绝缘子串（V 形跳线串 + 横担前后水平耐张串，统一用实物模型） ---------- */
  const insulatorMat = new THREE.MeshStandardMaterial({ color: 0x6e4a3a, metalness: 0.16, roughness: 0.72 });
  modelTasks.push(
    loadModel('/models/insulator-string.glb')
      .then((base) => {
        const rawBox = new THREE.Box3().setFromObject(base);
        const rawLength = rawBox.getSize(new THREE.Vector3()).y;
        if (rawLength < 1) return;
        const axis = new THREE.Vector3(0, 1, 0);
        strings.forEach(({ top, bottom }) => {
          const leg = base.clone(true);
          const dir = bottom.clone().sub(top);
          const length = dir.length();
          dir.normalize();
          leg.scale.setScalar(length / rawLength);
          leg.quaternion.setFromUnitVectors(axis, dir);
          leg.position.copy(top).add(bottom).multiplyScalar(0.5);
          leg.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.material = insulatorMat;
          });
          scene.add(leg);
        });
        deviceMaterials.push(insulatorMat);
      })
      .catch(() => {
        /* 资源缺失时保持其余塔体可用 */
      }),
  );

  /* ---------- 极线耐张串：实物三串模型（含均压环与两端连接金具）。
   *  塔端（模型局部 +Y 端）接横担下的三块带孔连接板，导线端（局部 -Y 端）接跳线；
   *  模型自带的整串长导线杆剔除，只保留绝缘子串与金具 ---------- */
  const TENSION_S = (TENSION_FAR_Z - TENSION_NEAR_Z) / (12.65 + 2.24);
  const tensionInsMat = new THREE.MeshStandardMaterial({ color: 0x7d5443, metalness: 0.16, roughness: 0.72 });
  /* 均压环与两端连接金具统一用铁塔钢构色，只有绝缘子本体保留红褐色 */
  const tensionSteelMat = new THREE.MeshStandardMaterial({ color: 0x8b9cb0, metalness: 0.38, roughness: 0.55 });
  /* 模型导线端下方伸出的 4 根细杆（均压环旁的断开垂吊段）及其端头卡具：不装到塔上；
   *  part0/1/2 是模型自带的三个间隔棒圆环（悬在已剔除的长导线杆上，与塔上六分裂导线对不上），一并剔除 */
  const TENSION_HIDDEN = new Set([
    'part0',
    'part1',
    'part2',
    'part13',
    'part14',
    'part15',
    'part16',
    'part34',
    'part35',
    'part36',
    'part37',
  ]);
  modelTasks.push(
    loadModel('/models/tension-insulator.glb')
      .then((base) => {
        /* 模型自带面片法线，绝缘子伞裙与金具棱角分明：先把重合顶点合并再重算法线，
         * 让三串绝缘子与连接金具像 V 形串一样圆润光滑 */
        const smoothed = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
        base.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          let aim = smoothed.get(mesh.geometry);
          if (!aim) {
            const src = mesh.geometry;
            src.deleteAttribute('normal');
            src.deleteAttribute('uv');
            aim = mergeVertices(src, 1e-3);
            aim.computeVertexNormals();
            smoothed.set(src, aim);
          }
          mesh.geometry = aim;
        });
        tensionSlots.forEach(({ side, dir }) => {
          const part = base.clone(true);
          part.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.computeBoundingBox();
            const box = mesh.geometry.boundingBox;
            if (!box) return;
            const size = box.getSize(new THREE.Vector3());
            if (TENSION_HIDDEN.has(mesh.name)) {
              mesh.visible = false;
              return;
            }
            if (size.y > 3 && box.min.y < -2.5) {
              mesh.visible = false;
              return;
            }
            /* 串长 ≈ 10~11m 的只有绝缘子本体（杆 + 伞裙），其余金具 / 均压环用钢构色 */
            const isInsulator = size.y > 9;
            mesh.material = isInsulator ? tensionInsMat : tensionSteelMat;
          });
          part.scale.setScalar(TENSION_S);
          /* 三串沿世界横担方向并排（模型 X → 世界 X），串长方向（模型 Y）沿线路方向水平拉出，
           * 三串落在同一水平面上，塔端连接板正好对上横担边缘的三对板 */
          part.quaternion.setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(
              new THREE.Vector3(1, 0, 0),
              new THREE.Vector3(0, 0, -dir),
              new THREE.Vector3(0, dir, 0),
            ),
          );
          part.position.set(
            side * TENSION_X,
            TENSION_Y,
            dir * (TENSION_NEAR_Z + 12.65 * TENSION_S),
          );
          /* 均压环一端（导线端）固定不动，整串绕该点微仰，使塔端贴到横担连接板底面 */
          const pivot = new THREE.Vector3(side * TENSION_X, TENSION_Y, dir * TENSION_FAR_Z);
          const tiltQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            TENSION_TILT * dir,
          );
          part.quaternion.premultiply(tiltQuat);
          part.position.sub(pivot).applyQuaternion(tiltQuat).add(pivot);
          scene.add(part);
        });
        deviceMaterials.push(tensionInsMat, tensionSteelMat);
        requestRender();
      })
      .catch(() => {
        /* 资源缺失时保持其余塔体可用 */
      }),
  );

  /* ---------- 实物间隔棒（六分裂导线） ---------- */
  const spacerMat = new THREE.MeshStandardMaterial({ color: 0xd2dce8, metalness: 0.55, roughness: 0.36 });
  modelTasks.push(
    loadModel('/models/spacer-damper.glb')
      .then((base) => {
        spacerSlots.forEach((slot) => {
          const part = base.clone(true);
          part.scale.setScalar(SPACER_SCALE);
          part.quaternion.copy(slot.quaternion);
          part.position.copy(slot.position);
          part.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.material = spacerMat;
          });
          scene.add(part);
        });
        deviceMaterials.push(spacerMat);
      })
      .catch(() => {
        /* 资源缺失时保持其余塔体可用 */
      }),
  );

  /* ---------- 跳线引流器两侧的抱箍间隔棒 + 鼠笼管 ----------
   * 跳线在引流器附近已捋直（z = ±CAGE_HALF 之间为直线段），
   * 四对抱箍间隔棒等距分布并正好覆盖 16m 长的鼠笼管 */
  /* 抱箍间隔棒：模型（trimesh 导出）只有 POSITION、没有法线，直接在缺法线状态下渲染会整片发黑，
   *  看起来只剩一圈轮廓、主体像透明的；这里补算法线并双面渲染 */
  const jumperBandMat = new THREE.MeshStandardMaterial({
    color: 0xcfdae6,
    metalness: 0.55,
    roughness: 0.36,
    side: THREE.DoubleSide,
  });
  const cageMat = new THREE.MeshStandardMaterial({ color: 0xb6c4d4, metalness: 0.58, roughness: 0.34 });
  modelTasks.push(
    loadModel('/models/jumper-band-spacer.glb')
      .then((base) => {
        const slots = [-8, -6, -4, -2, 2, 4, 6, 8];
        [-1, 1].forEach((side) => {
          slots.forEach((z) => {
            const part = base.clone(true);
            /* 模型六臂端头半径 0.485m，缩到 0.78 正好落在六分裂子导线的 0.38m 分布圆上 */
            part.scale.setScalar(0.78);
            part.position.set(side * 12.5, JUMPER_Y, z);
            part.traverse((child) => {
              const mesh = child as THREE.Mesh;
              if (!mesh.isMesh) return;
              mesh.material = jumperBandMat;
              /* 模型缺法线：按三角面补算，否则整片无光照、只剩轮廓 */
              if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
            });
            scene.add(part);
          });
        });
        deviceMaterials.push(jumperBandMat);
        requestRender();
      })
      .catch(() => {
        /* 资源缺失时保持其余塔体可用 */
      }),
  );
  modelTasks.push(
    loadModel('/models/squirrel-cage.glb')
      .then((base) => {
        [-1, 1].forEach((side) => {
          const part = base.clone(true);
          part.position.set(side * 12.5, JUMPER_Y, 0);
          part.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh) mesh.material = cageMat;
          });
          scene.add(part);
        });
        deviceMaterials.push(cageMat);
        requestRender();
      })
      .catch(() => {
        /* 资源缺失时保持其余塔体可用 */
      }),
  );

  /* ---------- 引流线绝缘子（实物模型）：Z 型卡夹塔腿，带孔卡箍抱引流导线 ---------- */
  const standoffMat = new THREE.MeshStandardMaterial({ color: 0x7a4e3c, metalness: 0.16, roughness: 0.7 });
  modelTasks.push(
    loadModel('/models/drain-insulator.glb')
      .then((base) => {
        standoffs.forEach((entry) => {
          const part = base.clone(true);
          /* 长度方向（模型 Y）按间距缩放，截面保持真实尺寸 */
          part.scale.set(0.001, 0.001 * entry.scale, 0.001);
          part.position.copy(entry.position);
          part.rotation.set(...entry.rotation);
          part.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.material = standoffMat;
          });
          scene.add(part);
        });
        deviceMaterials.push(standoffMat);
      })
      .catch(() => {
        /* 资源缺失时保持其余塔体可用 */
      }),
  );

  /* ---------- 导电杆附件：抱箍 / 环 ---------- */
  const placeOnRod = (
    url: string,
    scale: number,
    position: [number, number, number],
    rotation: [number, number, number],
    color: string,
    emissive: number,
    quaternion?: THREE.Quaternion,
  ) => {
    modelTasks.push(
      loadModel(url)
        .then((base) => {
          const part = base.clone(true);
          part.scale.setScalar(scale);
          part.position.fromArray(position);
          part.rotation.set(...rotation);
          if (quaternion) part.quaternion.copy(quaternion);
          part.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            const material = (mesh.material as THREE.MeshStandardMaterial).clone();
            material.color.set(color);
            material.emissive.set(color);
            material.emissiveIntensity = emissive;
            material.metalness = 0.4;
            material.roughness = 0.42;
            material.side = THREE.DoubleSide;
            mesh.material = material;
            deviceMaterials.push(material);
          });
          rodGroup.add(part);
        })
        .catch(() => {
          /* 资源缺失时保持其余塔体可用 */
        }),
    );
  };

  /* 抱箍：环孔轴线竖直，套在导电杆收细后的末端；带铁块触指的悬臂水平伸入引流器上部的罩子。
   * 模型 +Z（孔轴）→ 世界 +Y，模型 -Y（触指悬臂）→ 世界 +X */
  const bandQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ),
  );
  const bandBore = new THREE.Vector3(-5, 184, 12).multiplyScalar(BAND_SCALE);
  const bandPos = new THREE.Vector3(0, BAND_HOLE_Y, 0).sub(bandBore.applyQuaternion(bandQuat));
  placeOnRod(
    '/models/clamp-band.glb',
    BAND_SCALE,
    [bandPos.x, bandPos.y, bandPos.z],
    [0, 0, 0],
    '#0089a8',
    0.2,
    bandQuat,
  );
  /* 环：U 形锁扣环，两端带孔的脚板顺着导电杆方向一前一后、贴在杆的下表面；
   * 拱部朝抱箍的对侧（向上对着融冰锁），环面法线沿线路方向，与锁舌行程一致。
   * 环心由杆端沿杆轴推出 RING_ROD_DY，并径向偏 RING_ROD_DX：
   * 分闸到位时环孔中心正好落在融冰锁锁舌轴线上 */
  placeOnRod(
    '/models/ring.glb',
    0.0012,
    [RING_ROD_DX, ROD_TIP_LOCAL + RING_ROD_DY, 0],
    [0, 0, Math.PI / 2],
    '#0089a8',
    0.2,
  );
  /* 环的两个环抱箍：套在导电杆上，抱箍顶部的两个耳孔与环的两只脚板固定；
   * 模型 +Z（孔轴）→ 杆轴 +Y，模型 +Y（耳板）→ 世界 -X（对着环所在的杆侧） */
  const ringBandQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ),
  );
  [-1, 1].forEach((sign) => {
    placeOnRod(
      '/models/ring-band.glb',
      0.4,
      [0, ROD_TIP_LOCAL + RING_ROD_DY + sign * RING_FOOT_DY, 0],
      [0, 0, 0],
      '#0089a8',
      0.2,
      ringBandQuat,
    );
  });
  /* 导电杆上端：端部连接板抱箍随杆一起转动。
   * 带 7 个螺丝孔的一端朝上贴着减速器输出口、缩在罩内，圆筒段朝下套住导电杆上段；
   * 端板整体上移到杆的最端部（原来在杆端下方 0.5m，约等于一块端板长度）；
   * 先在杆轴上绕横轴翻 180°，再在水平面内绕竖轴翻 180°（分闸时绕世界 Y 轴） */
  const endPlateQuat = new THREE.Quaternion()
    .setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(1, 0, 0),
      ),
    )
    .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI))
    .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
  placeOnRod(
    '/models/rod-end-plate.glb',
    1,
    [0, 0, 0],
    [0, 0, 0],
    '#9fb0c4',
    0.06,
    endPlateQuat,
  );

  /* ---------- 保护罩：罩住导电杆端部与融冰锁 ----------
   * 抽屉面朝 +X（面向传动机构），融冰锁装在抽屉里；底部开口朝下供导电杆进入；
   * 罩顶吊耳用两根吊杆接横担下弦，罩体与锁不穿模 */
  /* 保护罩与融冰锁、传动机构同属橙色系，但取更亮的橘黄色，三者一眼可分 */
  const protectorMat = new THREE.MeshStandardMaterial({
    color: 0xff8c42,
    metalness: 0.42,
    roughness: 0.45,
    side: THREE.DoubleSide,
  });
  modelTasks.push(
    loadModel('/models/protector.glb')
      .then((base) => {
        const part = base.clone(true);
        part.scale.setScalar(PROTECTOR_SCALE);
        part.position.copy(PROTECTOR_POS);
        part.rotation.set(0, Math.PI / 2, 0);
        part.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = protectorMat;
        });
        scene.add(part);
        deviceMaterials.push(protectorMat);
        requestRender();
      })
      .catch(() => {
        /* 资源缺失时保持其余塔体可用 */
      }),
  );

  /* ---------- 明亮模式配色 ----------
   * 明亮模式下画布底色很浅，金属材质主要靠环境贴图反射，会「糊」成一片浅灰。
   * 这里记录每个材质的原始色，明亮模式整体压暗并压低环境反射强度，
   * 让本体色主导，主题切回深色时再恢复。 */
  let themeRef: TowerTheme = options.theme;
  const themeBase = new Map<
    THREE.MeshStandardMaterial,
    { color: THREE.Color; emissive: THREE.Color; envMapIntensity: number }
  >();
  function applyThemeTint(): void {
    /* 明亮模式：本体色压到 12%，环境反射压到 20%，钢构在浅底上呈中灰，线条轮廓清晰 */
    const k = themeRef === 'light' ? 0.12 : 1;
    const envK = themeRef === 'light' ? 0.2 : 1;
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach((entry) => {
        const material = entry as THREE.MeshStandardMaterial;
        if (!material || !material.isMeshStandardMaterial) return;
        if (indicatorMats.has(material)) return;
        let base = themeBase.get(material);
        if (!base) {
          base = {
            color: material.color.clone(),
            emissive: material.emissive.clone(),
            envMapIntensity: material.envMapIntensity,
          };
          themeBase.set(material, base);
        }
        material.color.copy(base.color).multiplyScalar(k);
        material.emissive.copy(base.emissive).multiplyScalar(k);
        material.envMapIntensity = base.envMapIntensity * envK;
      });
    });
    requestRender();
  }

  /* ---------- 交互 ---------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pressed = false;
  let pressX = 0;
  let pressY = 0;

  const pickKind = (event: PointerEvent): DeviceKind | undefined => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      let kind: DeviceKind | undefined;
      let visible = true;
      while (node) {
        if (!node.visible) visible = false;
        if (node.userData.kind) kind = node.userData.kind as DeviceKind;
        node = node.parent;
      }
      /* 隐藏的设备（如 MG400 上不存在的选相 3）不参与点击 */
      if (kind && visible) return kind;
    }
    return undefined;
  };

  const onPointerDown = (event: PointerEvent) => {
    pressed = true;
    pressX = event.clientX;
    pressY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!pressed) return;
    pressed = false;
    if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 6) return;
    const kind = pickKind(event);
    if (kind) options.onToggle(kind);
  };
  const onPointerMove = (event: PointerEvent) => {
    renderer.domElement.style.cursor = pickKind(event) ? 'pointer' : 'grab';
  };
  const onContextMenu = (event: Event) => event.preventDefault();
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('contextmenu', onContextMenu);

  /* 左键拖动模式切换：旋转 / 平移 */
  const setPanMode = (on: boolean) => {
    controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    renderer.domElement.style.cursor = on ? 'move' : 'grab';
  };

  /* ---------- 状态同步与动画 ---------- */
  let moduleRef: ModuleDto | null = null;
  let rodFrom = 0;
  let rodTo = 0;
  let rodAngle = 0;
  let animStart = 0;
  let animDuration = 0;
  let primed = false;
  /* 融冰锁推杆伸缩量：0 = 收回，1 = 伸出到位 */
  let lockExt = 0;
  let lockExtFrom = 0;
  let lockExtTo = 0;
  let lockAnimStart = 0;
  let lockAnimDuration = 0;
  let lockPrimed = false;

  /* 正弦型平滑：两端缓入缓出，中段接近匀速。三次方缓动中段过快，观感像「前半段磨蹭、
   * 后半段猛冲」，与设置里给的时长对不上 */
  const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

  /* ---------- 相机飞向快捷视角 ---------- */
  const fly = {
    active: false,
    start: 0,
    duration: 900,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
  };
  const flyTo = (view: TowerViewKey) => {
    const preset = VIEW_PRESETS[view] ?? VIEW_PRESETS.overview;
    fly.fromPos.copy(camera.position);
    fly.toPos.fromArray(preset.position);
    fly.fromTarget.copy(controls.target);
    fly.toTarget.fromArray(preset.target);
    fly.start = performance.now();
    fly.active = true;
    requestRender();
  };

  const applyVisuals = () => {
    if (!moduleRef) return;
    const module = moduleRef;
    (['phase1', 'phase2', 'phase3', 'ground1'] as DeviceKind[]).forEach((kind) => {
      const material = indicators[kind];
      if (!material) return;
      const color = colorOf(module, kind);
      material.color.set(color);
      material.emissive.set(color);
    });
    /* 选相 3 只在存在该设备的模块（MG500）上显示模型与点击热区 */
    (['phase1', 'phase2', 'phase3'] as DeviceKind[]).forEach((kind) => {
      const present = module.devices.includes(kind);
      const rig = phaseBlades.get(kind);
      if (rig) rig.group.visible = present;
      if (indicatorMeshes[kind]) indicatorMeshes[kind]!.visible = present;
      if (indicatorHits[kind]) indicatorHits[kind]!.visible = present;
    });
    /* 导电杆保持青色本体，不再随状态变色，避免被冲淡 */
    const locked = settle(module.states.iceLock) === 'locked';
    const lockColor = isMoving(module.states.iceLock)
      ? COLOR_MOVING
      : locked
        ? '#f59e0b'
        : COLOR_INITIAL;
    lockMaterials.forEach((material) => {
      material.emissive.set(lockColor);
      material.emissiveIntensity = 0.5;
    });
    tags.forEach((entry) => {
      const present = module.devices.includes(entry.kind);
      entry.el.style.display = present ? '' : 'none';
      const state = module.states[entry.kind];
      entry.el.dataset.state = isMoving(state)
        ? 'moving'
        : settle(state) === DEVICE_META[entry.kind].ice
          ? 'ice'
          : 'initial';
    });
  };

  const setModule = (module: ModuleDto) => {
    moduleRef = module;
    const settled = settle(module.states.iceSwitch);
    const closed = settled === 'closed';
    const target = closed ? 0 : ICE_OPEN_ANGLE;
    if (!primed) {
      primed = true;
      rodAngle = target;
      rodTo = target;
      rodFrom = target;
    } else if (target !== rodTo) {
      rodFrom = rodAngle;
      rodTo = target;
      animStart = performance.now();
      animDuration = Math.max(0.3, options.animIceSec) * 1000; /* 融冰刀闸：animIceSec */
    }
    rodGroup.rotation.z = rodAngle;

    /* 融冰锁推杆：锁止时伸出、解锁时收回 */
    const lockTarget = settle(module.states.iceLock) === 'locked' ? 1 : 0;
    if (!lockPrimed) {
      lockPrimed = true;
      lockExt = lockTarget;
      lockExtTo = lockTarget;
    } else if (lockTarget !== lockExtTo) {
      lockExtFrom = lockExt;
      lockExtTo = lockTarget;
      lockAnimStart = performance.now();
      lockAnimDuration = Math.max(0.3, options.animLockSec) * 1000;
    }

    /* 接地刀闸：合闸时闸刀落下、鼓轮同步转动 */
    const groundSettled = settle(module.states.ground1);
    const groundTarget = groundSettled === 'closed' ? 1 : 0;
    if (!groundPrimed) {
      groundPrimed = true;
      groundProgress = groundTarget;
      groundFrom = groundTarget;
      groundTo = groundTarget;
    } else if (groundTarget !== groundTo) {
      groundFrom = groundProgress;
      groundTo = groundTarget;
      groundAnimStart = performance.now();
      groundAnimDuration = Math.max(0.3, options.animSwitchSec) * 1000;
    }

    /* 选相刀闸：合闸时闸刀搭到另一根绝缘子顶部，分闸时在水平面内转过 90° */
    phaseBlades.forEach((rig, kind) => {
      const target = settle(module.states[kind]) === 'closed' ? 1 : 0;
      if (!rig.primed) {
        rig.primed = true;
        rig.progress = target;
        rig.to = target;
      } else if (target !== rig.to) {
        rig.from = rig.progress;
        rig.to = target;
        rig.start = performance.now();
        rig.duration = Math.max(0.3, options.animSwitchSec) * 1000;
      }
    });

    applyVisuals();
    requestRender();
  };

  /* ---------- 自适应尺寸 ---------- */
  const resize = () => {
    const w = host.clientWidth || width;
    const h = host.clientHeight || height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  /* ---------- 渲染循环 ----------
   * 按需渲染：只有相机在动、动画在播、或有新模型/状态需要落到画面上时才渲染一帧。
   * 静止时完全不占 GPU / CPU（原来每帧无条件渲染是风扇狂响的主因）。 */
  const tagPoint = new THREE.Vector3();
  const updateTags = () => {
    const w = renderer.domElement.clientWidth || 1;
    const h = renderer.domElement.clientHeight || 1;
    tags.forEach((entry) => {
      if (entry.el.style.display === 'none') return;
      tagPoint.copy(entry.anchor).project(camera);
      if (tagPoint.z > 1 || Math.abs(tagPoint.x) > 1.1 || Math.abs(tagPoint.y) > 1.1) {
        entry.el.style.visibility = 'hidden';
        return;
      }
      entry.el.style.visibility = 'visible';
      const x = (tagPoint.x * 0.5 + 0.5) * w + entry.offset[0];
      const y = (-tagPoint.y * 0.5 + 0.5) * h + entry.offset[1];
      entry.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    });
  };

  let frame = 0;
  function loop() {
    frame = 0;
    const now = performance.now();
    let busy = false;
    if (animDuration > 0) {
      const t = Math.min(1, (now - animStart) / animDuration);
      rodAngle = rodFrom + (rodTo - rodFrom) * easeInOut(t);
      rodGroup.rotation.z = rodAngle;
      if (t >= 1) animDuration = 0;
      busy = true;
    }
    if (lockAnimDuration > 0) {
      const t = Math.min(1, (now - lockAnimStart) / lockAnimDuration);
      lockExt = lockExtFrom + (lockExtTo - lockExtFrom) * easeInOut(t);
      if (t >= 1) lockAnimDuration = 0;
      busy = true;
    }
    if (groundAnimDuration > 0) {
      const t = Math.min(1, (now - groundAnimStart) / groundAnimDuration);
      groundProgress = groundFrom + (groundTo - groundFrom) * easeInOut(t);
      if (t >= 1) groundAnimDuration = 0;
      busy = true;
    }
    if (groundRig) {
      groundRig.blade.rotation.x = GROUND_BLADE_CLOSED * groundProgress;
      groundRig.drum.rotation.x = GROUND_DRUM_TURN * groundProgress;
    }
    phaseBlades.forEach((rig) => {
      if (rig.duration > 0) {
        const t = Math.min(1, (now - rig.start) / rig.duration);
        rig.progress = rig.from + (rig.to - rig.from) * easeInOut(t);
        if (t >= 1) rig.duration = 0;
        busy = true;
      }
      /* progress=1 时刀身沿 +Z 搭在后侧支柱上；分闸时向塔外侧摆开 90° */
      rig.pivot.rotation.y = rig.sign * (Math.PI / 2) * (1 - rig.progress);
    });
    if (lockPush) {
      /* 锁舌在锁体内部沿自身轴向滑动：开锁时缩回，露出缺口让环进入；闭锁时伸出，把缺口连上锁住环 */
      lockPush.position.x = -LOCK_PIN_TRAVEL * 1000 * (1 - lockExt);
    }
    if (fly.active) {
      const t = Math.min(1, (now - fly.start) / fly.duration);
      const k = easeInOut(t);
      camera.position.lerpVectors(fly.fromPos, fly.toPos, k);
      controls.target.lerpVectors(fly.fromTarget, fly.toTarget, k);
      if (t >= 1) fly.active = false;
      busy = true;
    }
    /* OrbitControls 阻尼未停时返回 true，需要继续出帧 */
    if (controls.update()) busy = true;
    renderer.render(scene, camera);
    updateTags();
    if (busy) requestRender();
  }
  function requestRender() {
    if (frame) return;
    frame = requestAnimationFrame(loop);
  }
  /* 拖动 / 滚轮等一切让相机变化的操作都要补一帧 */
  controls.addEventListener('change', requestRender);
  /* 初始主题先落一次（塔架 / 导线等合批网格），全部外部模型就位后再统一压暗一次 */
  applyThemeTint();
  void Promise.all(modelTasks).then(() => applyThemeTint());
  requestRender();

  return {
    setModule,
    flyTo,
    setCamera: (position, target) => {
      camera.position.fromArray(position);
      controls.target.fromArray(target);
      controls.update();
      requestRender();
    },
    setPanMode,
    setTheme: (theme) => {
      themeRef = theme;
      applyThemeTint();
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      towerGroup.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      });
      deviceMaterials.forEach((material) => material.dispose());
      rodMat.dispose();
      tagLayer.remove();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
