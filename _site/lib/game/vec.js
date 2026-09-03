/** 2D vector math over plain {x, y} objects. Nothing here mutates an argument. */
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v, k) => ({ x: v.x * k, y: v.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const len = (v) => Math.hypot(v.x, v.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (v) => {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
};
export const clampLen = (v, max) => {
  const l = len(v);
  return l <= max ? v : scale(v, max / l);
};
