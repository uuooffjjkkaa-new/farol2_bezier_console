/**
 * MotionPlanningConsole canvas helper module.
 *
 * This module manages the map canvas, rendering, zoom/pan, and
 * object interactions such as vehicle, goal, obstacle, and trajectory drawing.
 */

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');

const centerEasting = 491899;
const centerNorthing = 4290842;
const scale = 3;
const ESizeMeters = 298;
const NSizeMeters = 208;
const mapMinE = centerEasting - ESizeMeters / 2;
const mapMaxE = centerEasting + ESizeMeters / 2;
const mapMinN = centerNorthing - NSizeMeters / 2;
const mapMaxN = centerNorthing + NSizeMeters / 2;

let scaleFactor = 1;
let offsetX = 0;
let offsetY = 0;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let selectedVehicle = null;
let selectedObstacle = null;

const background = new Image();
background.src = 'map_expo_color.png';
let backgroundLoaded = false;

const obstacleImg = new Image();
obstacleImg.src = 'island_circ.png';

background.onload = () => {
  backgroundLoaded = true;
  drawAllObjects();
};

function initCanvas({ onClick, onWheel, onMouseDown, onMouseMove, onMouseUp }) {
  canvas.addEventListener('click', (event) => {
    if (typeof onClick === 'function') onClick(event);
  });

  canvas.addEventListener('wheel', (event) => {
    if (typeof onWheel === 'function') onWheel(event);
  });

  canvas.addEventListener('mousedown', (event) => {
    if (typeof onMouseDown === 'function') onMouseDown(event);
  });

  canvas.addEventListener('mousemove', (event) => {
    if (typeof onMouseMove === 'function') onMouseMove(event);
  });

  canvas.addEventListener('mouseup', () => {
    if (typeof onMouseUp === 'function') onMouseUp();
  });

  canvas.addEventListener('mouseleave', () => {
    if (typeof onMouseUp === 'function') onMouseUp();
  });
}

function worldToCanvas(E, N) {
  const cx = (E - centerEasting) * scale + canvas.width / 2;
  const cy = canvas.height / 2 - (N - centerNorthing) * scale;
  return { cx, cy };
}

function canvasToWorld(cx, cy) {
  const x1 = (cx - offsetX) / scaleFactor;
  const y1 = (cy - offsetY) / scaleFactor;
  const E = (x1 - canvas.width / 2) / scale + centerEasting;
  const N = centerNorthing - (y1 - canvas.height / 2) / scale;
  return { E, N };
}

function setSelectedVehicle(vehicleName) {
  selectedVehicle = vehicleName;
}

function getSelectedVehicle() {
  return selectedVehicle;
}

function setSelectedObstacle(obstacleId) {
  selectedObstacle = obstacleId;
}

function getSelectedObstacle() {
  return selectedObstacle;
}

function drawBackground() {
  if (!backgroundLoaded) return;

  const x1 = (mapMinE - centerEasting) * scale + canvas.width / 2;
  const y1 = canvas.height / 2 - (mapMaxN - centerNorthing) * scale;
  const width = (mapMaxE - mapMinE) * scale;
  const height = (mapMaxN - mapMinN) * scale;

  ctx.drawImage(background, x1, y1, width, height);
}

function drawGoal(E, N, yaw, color, id) {
  const p = worldToCanvas(E, N);
  ctx.save();
  ctx.translate(p.cx, p.cy);
  ctx.rotate((yaw * Math.PI) / 180 - Math.PI / 2);

  ctx.beginPath();
  ctx.arc(-6 / scaleFactor, 0, 6 / scaleFactor, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(12 / scaleFactor, 0);
  ctx.lineTo(-6 / scaleFactor, 6 / scaleFactor);
  ctx.lineTo(-6 / scaleFactor, -6 / scaleFactor);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  const fontSize = 10 / scaleFactor;
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'white';
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(id, 0, 3 / scaleFactor);
  ctx.restore();
}

function drawVehicle(E, N, yaw, color, id, isSelected) {
  const p = worldToCanvas(E, N);

  ctx.save();
  ctx.translate(p.cx, p.cy);
  ctx.rotate(yaw);

  ctx.beginPath();
  ctx.moveTo(12 / scaleFactor, 0);
  ctx.lineTo(-6 / scaleFactor, 6 / scaleFactor);
  ctx.lineTo(-6 / scaleFactor, -6 / scaleFactor);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  if (isSelected) {
    ctx.lineWidth = 1.5 / scaleFactor;
    ctx.strokeStyle = 'yellow';
    ctx.stroke();
  }

  const fontSize = 10 / scaleFactor;
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'white';
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(id, 0, 0);
  ctx.restore();
}

function drawObstacle(E, N, radius, color, label, isSelected) {
  const cx = (E - centerEasting) * scale + canvas.width / 2;
  const cy = canvas.height / 2 - (N - centerNorthing) * scale;
  const pixelRadius = radius * scale;

  ctx.save();
  ctx.translate(cx, cy);

  if (obstacleImg.complete) {
    ctx.drawImage(obstacleImg, -pixelRadius, -pixelRadius, pixelRadius * 2, pixelRadius * 2);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, pixelRadius, 0, 2 * Math.PI);
    ctx.fillStyle = 'yellow';
    ctx.fill();
  }

  if (isSelected) {
    ctx.lineWidth = 1.5 / scaleFactor;
    ctx.strokeStyle = 'yellow';
    ctx.beginPath();
    ctx.arc(0, 0, pixelRadius, 0, 2 * Math.PI);
    ctx.stroke();
  }

  ctx.restore();
}

function drawTrajectory(points, color) {
  if (!points || points.length < 2) return;

  ctx.beginPath();
  const p0 = worldToCanvas(points[0].E, points[0].N);
  ctx.moveTo(p0.cx, p0.cy);

  for (let i = 1; i < points.length; i++) {
    const p = worldToCanvas(points[i].E, points[i].N);
    ctx.lineTo(p.cx, p.cy);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 / scaleFactor;
  ctx.stroke();
}

function drawExecutionTrace(samples, color = 'cyan') {
  if (!samples || samples.length < 2) return;

  ctx.beginPath();
  const p0 = worldToCanvas(samples[0].E, samples[0].N);
  ctx.moveTo(p0.cx, p0.cy);

  for (let i = 1; i < samples.length; i++) {
    const p = worldToCanvas(samples[i].E, samples[i].N);
    ctx.lineTo(p.cx, p.cy);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 / scaleFactor;
  ctx.stroke();
}

function findVehicleAt(E, N, vehicles, toleranceMeters = 5) {
  for (const name in vehicles) {
    const v = vehicles[name];
    const dx = v.E - E;
    const dy = v.N - N;
    if (Math.sqrt(dx * dx + dy * dy) < toleranceMeters / scaleFactor) {
      return name;
    }
  }
  return null;
}

function findObstacleAt(E, N, obstacles, obstacleIds) {
  for (const id of obstacleIds) {
    const obs = obstacles[id];
    const dx = E - obs.E;
    const dy = N - obs.N;
    if (Math.sqrt(dx * dx + dy * dy) < obs.radius) return id;
  }
  return null;
}

function drawAllObjects({ goals, vehicles, plannedTrajectories, executionSamples, obstacleIds, obstacles, visibleTrajectories }) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(offsetX, offsetY);
  ctx.scale(scaleFactor, scaleFactor);

  drawBackground();

  for (const name in goals) {
    const g = goals[name];
    const v = vehicles[name];
    if (!v) continue;
    drawGoal(g.E, g.N, g.theta ?? 0, v.color, v.id);
  }

  for (const name in plannedTrajectories) {
    if (!visibleTrajectories.has(name)) continue;
    const v = vehicles[name];
    if (!v) continue;
    drawTrajectory(plannedTrajectories[name], v.color);
  }

  for (const name in executionSamples) {
    if (!executionSamples[name]?.length) continue;
    drawExecutionTrace(executionSamples[name]);
  }

  for (const id of obstacleIds) {
    const obs = obstacles[id];
    drawObstacle(obs.E, obs.N, obs.radius, obs.color, id, id === selectedObstacle);
  }

  for (const name in vehicles) {
    const v = vehicles[name];
    drawVehicle(v.E, v.N, v.yaw, v.color, v.id, name === selectedVehicle);
  }
}

function zoomCanvas(event) {
  event.preventDefault();
  if (!event.altKey) return;

  const zoomAmount = -event.deltaY * 0.001;
  const oldScale = scaleFactor;
  scaleFactor = Math.max(0.5, Math.min(3, scaleFactor + zoomAmount));

  const rect = canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;

  offsetX -= (mx - canvas.width / 2 - offsetX) * (scaleFactor / oldScale - 1);
  offsetY -= (my - canvas.height / 2 - offsetY) * (scaleFactor / oldScale - 1);
}

function beginDrag(event) {
  if (!event.altKey) return;
  isDragging = true;
  dragStart.x = event.clientX - offsetX;
  dragStart.y = event.clientY - offsetY;
}

function dragCanvas(event) {
  if (!isDragging) return;
  offsetX = event.clientX - dragStart.x;
  offsetY = event.clientY - dragStart.y;
}

function endDrag() {
  isDragging = false;
}

export {
  initCanvas,
  drawAllObjects,
  worldToCanvas,
  canvasToWorld,
  findVehicleAt,
  findObstacleAt,
  setSelectedVehicle,
  getSelectedVehicle,
  setSelectedObstacle,
  getSelectedObstacle,
  zoomCanvas,
  beginDrag,
  dragCanvas,
  endDrag
};
