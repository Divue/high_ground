export const waterVert = /* glsl */ `
uniform sampler2D elevTex;
uniform sampler2D depthA;
uniform sampler2D depthB;
uniform float mixT;
uniform float rise;          // 0..1 multiplier used by the "water rises" animation
uniform float zPerMeter;     // mercator units per metre
uniform float terrainExag;
uniform float depthExag;
varying float vDepth;
varying vec2 vUv;
varying vec3 vWorld;

float depthAt(vec2 uv) {
  float a = texture2D(depthA, uv).r * 2.55;   // metres (texture holds cm/100 scaled to 0..1 over 0..255 cm)
  float b = texture2D(depthB, uv).r * 2.55;
  return mix(a, b, mixT) * rise;
}

void main() {
  vUv = uv;
  float elev = texture2D(elevTex, uv).r;
  float d = depthAt(uv);
  vDepth = d;
  vec3 p = position;
  p.z = (elev * terrainExag + d * depthExag + 0.25) * zPerMeter;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const waterFrag = /* glsl */ `
uniform sampler2D depthA;
uniform sampler2D depthB;
uniform float mixT;
uniform float rise;
uniform float time;
uniform vec3 shallow;
uniform vec3 deep;
uniform vec3 amber;
uniform vec3 camPos;
uniform vec2 lights[12];
uniform float opacity;
uniform float minDepth;      // zoomed out: only show water that matters (>= 15 cm)
uniform float detail;        // 0 zoomed out .. 1 zoomed in: smooth shorelines and depth contours
uniform vec2 texSize;
varying float vDepth;
varying vec2 vUv;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// B-spline filter from 4 bilinear taps (Sigg and Hadwiger, GPU Gems 2 ch. 20): rounds the 30 m cells.
// Display only: every number shown to users comes from the street JSON, not from these textures.
vec4 cubicW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v; vec4 s = n * n * n;
  float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
}
float bicubicR(sampler2D tex, vec2 uv) {
  vec2 inv = 1.0 / texSize; uv = uv * texSize - 0.5;
  vec2 f = fract(uv); uv -= f;
  vec4 xc = cubicW(f.x), yc = cubicW(f.y);
  vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) * inv.xxyy;
  float a = texture2D(tex, o.xz).r, b = texture2D(tex, o.yz).r, c2 = texture2D(tex, o.xw).r, d = texture2D(tex, o.yw).r;
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(d, c2, sx), mix(b, a, sx), sy);
}
float sampleDepth(sampler2D tex, vec2 uv) {
  return detail > 0.01 ? mix(texture2D(tex, uv).r, bicubicR(tex, uv), detail) : texture2D(tex, uv).r;
}
// anti-aliased line where d crosses level
float iso(float d, float level) {
  float w = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(0.5 * w, 1.5 * w, abs(d - level));
}

void main() {
  // depth sampled per pixel so shorelines follow the data, not mesh triangles
  float depth = mix(sampleDepth(depthA, vUv), sampleDepth(depthB, vUv), mixT) * 2.55 * rise;
  if (depth < minDepth) discard;
  float t = smoothstep(0.03, 1.2, depth);
  vec3 col = mix(shallow, deep, t);
  // scrolling ripples -> perturbed normal
  vec2 q = vUv * vec2(900.0, 1500.0);
  float n1 = noise(q * 0.35 + vec2(time * 0.6, time * 0.4));
  float n2 = noise(q * 0.9 - vec2(time * 0.9, -time * 0.5));
  float rip = 1.0 - smoothstep(0.05, 0.14, minDepth);   // ripples only when zoomed in
  vec3 nrm = normalize(vec3((n1 - 0.5) * 0.35 * rip, (n2 - 0.5) * 0.35 * rip, 1.0));
  vec3 view = normalize(camPos - vWorld);
  float fres = pow(1.0 - clamp(dot(nrm, view), 0.0, 1.0), 3.0);
  col = mix(col, vec3(0.78, 0.86, 0.9), fres * 0.35);
  // amber glints from street lights at junctions
  float glint = 0.0;
  for (int i = 0; i < 12; i++) {
    float d = distance(vUv, lights[i]);
    glint += exp(-d * d * 9000.0) * (0.6 + 0.4 * n1);
  }
  col += amber * glint * 0.55;
  float edge = smoothstep(minDepth, minDepth + 0.11, depth);
  // deeper water carries more weight: shallow is translucent, deep is opaque
  float a = opacity * edge * mix(0.5, 1.0, t);
  col *= 1.12;
  // the two safety thresholds drawn on the water: thin 15 cm (two-wheelers), bold 30 cm (cars)
  float lines = max(0.5 * iso(depth, 0.15), 0.95 * iso(depth, 0.30)) * detail;
  col = mix(col, vec3(0.79, 0.83, 0.85), lines);
  a = max(a, opacity * lines * 0.9);
  gl_FragColor = vec4(col * a, a);  // premultiplied
}
`

export const rainVert = /* glsl */ `
attribute vec3 offset;
attribute float speed;
uniform float time;
uniform float boxSize;
uniform vec3 center;
uniform float streak;
varying float vA;
void main() {
  vec3 o = offset;
  o.z = mod(offset.z - time * speed, 1.0);
  vec3 p = center + vec3((o.x - 0.5) * boxSize, (o.y - 0.5) * boxSize, o.z * boxSize * 0.6);
  p += vec3(position.x * boxSize * 0.00025, 0.0, position.y * streak);
  vA = smoothstep(0.0, 0.15, o.z) * (1.0 - smoothstep(0.85, 1.0, o.z));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`

export const rainFrag = /* glsl */ `
uniform float opacity;
varying float vA;
void main() {
  float a = opacity * vA * 0.22;
  gl_FragColor = vec4(vec3(0.79, 0.83, 0.85) * a, a);
}
`
