import * as THREE from 'three'

// Scene palette: an architectural model. Only status halos carry saturated colour.
export const SCENE = {
  plaster: '#f5f6f3',
  terrazzo: '#e7e8e3',
  deck: '#d8d0c2',
  deckLine: '#c6bbab',
  plinth: '#c9cfcb',
  linen: '#fbfbf8',
  oak: '#b8936b',
  ink: '#2b3640',
  sage: '#7f8f88',
  sageDark: '#73837c',
  leaf: '#8fa58c',
  leafDark: '#7e9879',
  stone: '#e2ded6',
  glass: '#cfe0e4',
  counter: '#eae6dd',
  dimmed: '#aeb6b2',
}

function speckledTexture(): THREE.CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  g.fillStyle = SCENE.terrazzo
  g.fillRect(0, 0, size, size)
  const chips = ['#c9ccc4', '#b7bdb8', '#d9c9b4', '#a9b2ae']
  // Deterministic speckle so the floor doesn't shimmer between mounts.
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = chips[i % chips.length]
    g.beginPath()
    g.arc(rand() * size, rand() * size, rand() * 2.4 + 0.6, 0, Math.PI * 2)
    g.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3, 3)
  texture.anisotropy = 8
  return texture
}

const matte = (color: string, roughness = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra })

let cache: ReturnType<typeof build> | null = null

function build() {
  return {
    plaster: matte(SCENE.plaster, 0.95),
    terrazzo: new THREE.MeshStandardMaterial({ map: speckledTexture(), roughness: 0.9 }),
    deck: matte(SCENE.deck),
    deckLine: matte(SCENE.deckLine),
    plinth: matte(SCENE.plinth),
    linen: matte(SCENE.linen, 0.95),
    oak: matte(SCENE.oak, 0.7),
    ink: matte(SCENE.ink, 0.6),
    sage: matte(SCENE.sage),
    sageDark: matte(SCENE.sageDark),
    leaf: matte(SCENE.leaf, 0.9, { flatShading: true }),
    leafDark: matte(SCENE.leafDark, 0.9, { flatShading: true }),
    stone: matte(SCENE.stone),
    counter: matte(SCENE.counter),
    window: matte('#dce4e7', 0.3),
    bottleGreen: matte('#3e5a52', 0.4),
    bottleAmber: matte('#7a4b33', 0.4),
    glass: new THREE.MeshStandardMaterial({ color: SCENE.glass, transparent: true, opacity: 0.28, roughness: 0.1 }),
    plate: matte('#ffffff', 0.5),
    napkin: matte('#f2f0ea', 0.9, { flatShading: true }),
    tumbler: new THREE.MeshStandardMaterial({ color: '#d8e6ea', transparent: true, opacity: 0.75, roughness: 0.15 }),
    candle: matte('#e9c46a', 0.4, { emissive: '#e9a23b', emissiveIntensity: 0.35 }),
    cloth: matte('#7a4db3', 0.8),
    screen: matte('#1b2733', 0.3),
  }
}

export function materials() {
  cache ??= build()
  return cache
}

export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}
