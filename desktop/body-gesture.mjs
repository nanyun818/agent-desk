export function createBodyGesture(threshold = 6) {
  let active = null;
  const valid = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
  return {
    get pointerId() { return active?.pointerId ?? null; },
    begin(point) {
      if (active || !valid(point)) return false;
      active = { pointerId: point.pointerId, start: { x: point.x, y: point.y }, dragged: false }; return true;
    },
    move(point) {
      if (!active || point.pointerId !== active.pointerId || !valid(point)) return null;
      const started = !active.dragged && Math.hypot(point.x - active.start.x, point.y - active.start.y) >= threshold;
      if (started) active.dragged = true;
      return { started, dragging: active.dragged, start: active.start, point: { x: point.x, y: point.y } };
    },
    finish(pointerId, cancelled = false) {
      if (!active || pointerId !== active.pointerId) return null;
      const result = { dragged: active.dragged, cancelled }; active = null; return result;
    },
  };
}
