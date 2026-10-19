import { createBodyGesture } from './body-gesture.mjs';
const pet = document.getElementById('pet');
const messages = { idle: '桃铃在呢', thinking: '正在想办法…', done: '完成啦！', error: '遇到问题啦', greeting: '桃桃来啦！', petted: '喵～再摸一下嘛' };
let previousPats, baseImage, happyImage, patTimer, patAnimation;
function update(state) {
  pet.dataset.status = state.status; pet.dataset.motion = state.motion ? 'active' : 'paused';
  document.getElementById('bubble').textContent = messages[state.status] || messages.idle;
  document.getElementById('pat-count').textContent = `猫猫头 ${state.pats || 0} 次`;
  const portrait = document.getElementById('portrait');
  if (baseImage) portrait.src = state.status === 'petted' && happyImage ? happyImage : baseImage;
  if (previousPats !== undefined && state.pats > previousPats) {
    clearTimeout(patTimer); patAnimation?.cancel();
    pet.removeAttribute('data-patting'); void pet.offsetWidth; pet.dataset.patting = 'yes';
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) patAnimation = portrait.animate([{ transform: 'scale(1)' }, { transform: 'translateY(3px) scale(1.025, .96) rotate(-2deg)', offset: .3 }, { transform: 'translateY(-3px) rotate(2deg)', offset: .65 }, { transform: 'scale(1)' }], { duration: 700, easing: 'ease-in-out' });
    patTimer = setTimeout(() => pet.removeAttribute('data-patting'), 1100);
  }
  previousPats = state.pats || 0;
}
function action(name) { window.taolingPet[name]().catch(() => { document.getElementById('bubble').textContent = '暂时没响应，再试一下'; }); }
window.taolingPet.config().then(config => {
  baseImage = config.image; happyImage = config.happyImage;
  document.getElementById('portrait').onerror = () => { happyImage = null; document.getElementById('portrait').src = baseImage; };
  for (const name of ['menu', 'close', 'open', 'greet', 'chat', 'drag', 'hand']) document.getElementById(name + '-icon').src = config.icons[name];
  update(config.state);
}).catch(() => { document.getElementById('bubble').textContent = '桃铃暂时休息'; });
window.taolingPet.onState(update);
document.getElementById('menu').addEventListener('click', () => action('menu'));
document.getElementById('hide').addEventListener('click', () => action('hide'));
document.getElementById('open').addEventListener('click', () => action('open'));
document.getElementById('greet').addEventListener('click', () => action('greet'));
document.getElementById('head').addEventListener('click', () => action('pat'));
const body = document.getElementById('chat-body'), gesture = createBodyGesture();
let suppressClick = false, dragQueue = Promise.resolve(), moveFrame, pendingMove;
const point = event => ({ pointerId: event.pointerId, x: event.screenX, y: event.screenY });
function moveWindow(phase, position) {
  dragQueue = dragQueue.then(() => window.taolingPet.drag(phase, position)).catch(() => { document.getElementById('bubble').textContent = '移动暂时没响应，再试一下'; });
}
function flushMove() {
  cancelAnimationFrame(moveFrame); moveFrame = null;
  if (pendingMove) { moveWindow('move', pendingMove); pendingMove = null; }
}
function moveBody(event) {
  const result = gesture.move(point(event)); if (!result?.dragging) return;
  if (result.started) { pet.dataset.dragging = 'yes'; moveWindow('start', result.start); }
  pendingMove = result.point;
  if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
}
function finishBody(event, cancelled = false) {
  if (!cancelled) moveBody(event);
  const result = gesture.finish(event.pointerId, cancelled); if (!result) return;
  suppressClick = result.dragged || result.cancelled;
  if (result.dragged) { flushMove(); moveWindow('end'); dragQueue.then(() => { if (gesture.pointerId === null) delete pet.dataset.dragging; }); }
  if (body.hasPointerCapture(event.pointerId)) body.releasePointerCapture(event.pointerId);
}
body.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary || !gesture.begin(point(event))) return;
  suppressClick = false; body.setPointerCapture(event.pointerId);
});
body.addEventListener('pointermove', moveBody);
body.addEventListener('pointerup', event => finishBody(event));
body.addEventListener('pointercancel', event => finishBody(event, true));
body.addEventListener('lostpointercapture', event => finishBody(event, true));
body.addEventListener('click', event => {
  if (event.detail && suppressClick) { suppressClick = false; event.preventDefault(); return; }
  action('chat');
});
document.getElementById('chat').addEventListener('click', () => action('chat'));
document.addEventListener('contextmenu', event => { event.preventDefault(); action('menu'); });
