/**
 * MotionPlanningConsole canvas helper module.
 *
 * This module manages the map canvas, rendering, zoom/pan, and
 * object interactions such as vehicle, goal, obstacle, and trajectory drawing.
 */

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');

const centerEasting = 481685; //491899;
const centerNorthing = 4282433; //4290842;
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
let handleDragMode = null;      // null | 'handleA' | 'handleB'
let handleDragObstacleId = null;
let handleDragOccurred = false; // guards against click firing after a handle drag
let handleDragVehicleId = null;
let handleDragGoalId = null;

const VELOCITY_ARROW_SCALE = 40; // world meters of arrow length per 1 m/s of surge

const background = new Image();
background.src = 'assets/map_expo_color.png';
let backgroundLoaded = false;

const obstacleImg = new Image();
obstacleImg.src = 'assets/island_circ.png';

background.onload = () => {
  backgroundLoaded = true;
  drawAllObjects();
};

function initCanvas({ onClick, onRightClick, onWheel, onMouseDown, onMouseMove, onMouseUp }) {
  canvas.addEventListener('click', (event) => {
    if (typeof onClick === 'function') onClick(event);
  });

  canvas.addEventListener('contextmenu', (event) => {
    if (typeof onRightClick === 'function') onRightClick(event);
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

function drawGoal(goal, color, id, isSelected) {

  console.log("GOAL OBJECT:", goal);
  console.log("GOAL E/N:", goal.E, goal.N);
  console.log("GOAL YAW:", goal.yaw);
  console.log("GOAL V:", goal.v);
  console.log("SELECTED:", isSelected);

  const yaw = goal.yaw ?? 0;
  const v = goal.v ?? 0.01;

  const p = worldToCanvas(goal.E, goal.N);
  ctx.save();
  ctx.translate(p.cx, p.cy);
  ctx.rotate((goal.yaw ?? 0));

  

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

  ctx.beginPath();
  ctx.arc(-6 / scaleFactor, 0, 6 / scaleFactor, 0, 2 * Math.PI);
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
  if (isSelected) {
    drawArrow({ E: goal.E, N: goal.N, yaw: yaw, v: v });
  }
}

function drawVehicle(veh, isSelected) {
  const p = worldToCanvas(veh.E, veh.N);

  ctx.save();
  ctx.translate(p.cx, p.cy);
  ctx.rotate(veh.yaw);

  ctx.beginPath();
  ctx.moveTo(12 / scaleFactor, 0);
  ctx.lineTo(-6 / scaleFactor, 6 / scaleFactor);
  ctx.lineTo(-6 / scaleFactor, -6 / scaleFactor);
  ctx.closePath();
  ctx.fillStyle = veh.color;
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
  ctx.fillText(veh.id, 0, 0);
  ctx.restore();

  if (isSelected) {
    drawArrow(veh);
  }
}

function drawObstacle(obs, id, isSelected) {
  const cx = (obs.E - centerEasting) * scale + canvas.width / 2;
  const cy = canvas.height / 2 - (obs.N - centerNorthing) * scale;
  const pxA = obs.a * scale;
  const pxB = obs.b * scale;
  // canvas Y is flipped relative to world N, so negate phi for screen rotation
  const screenPhi = -obs.phi;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(screenPhi);

  if (obstacleImg.complete) {
    ctx.drawImage(obstacleImg, -pxA, -pxB, pxA * 2, pxB * 2);
  } else {
    ctx.beginPath();
    ctx.ellipse(0, 0, pxA, pxB, 0, 0, 2 * Math.PI);
    ctx.fillStyle = 'yellow';
    ctx.fill();
  }

  if (isSelected) {
    ctx.lineWidth = 1.5 / scaleFactor;
    ctx.strokeStyle = 'yellow';
    ctx.beginPath();
    ctx.ellipse(0, 0, pxA, pxB, 0, 0, 2 * Math.PI);
    ctx.stroke();

    // Handle A: stretch + rotate (sits at the tip of the semi-major axis)
    ctx.beginPath();
    ctx.arc(pxA, 0, 5, 0, 2 * Math.PI);
    ctx.fillStyle = 'cyan';
    ctx.fill();

    // Handle B: width only (sits at the tip of the semi-minor axis)
    ctx.beginPath();
    ctx.arc(0, pxB, 5, 0, 2 * Math.PI);
    ctx.fillStyle = 'lime';
    ctx.fill();
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

function drawArrow(obj) {
  const { cx: ocx, cy: ocy } = worldToCanvas(obj.E, obj.N);
  const armLength = Math.max(obj.v, 0.01) * VELOCITY_ARROW_SCALE * scale;
  const tipX = ocx + Math.cos(obj.yaw) * armLength;
  const tipY = ocy + Math.sin(obj.yaw) * armLength;

  ctx.save();
  ctx.strokeStyle = '#e63946';
  ctx.lineWidth = 2 / scaleFactor;
  ctx.beginPath();
  ctx.moveTo(ocx, ocy);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(tipX, tipY, 6 / scaleFactor, 0, 2 * Math.PI);
  ctx.fillStyle = '#e63946';
  ctx.fill();

  ctx.fillStyle = '#000';
  ctx.font = `${12 / scaleFactor}px sans-serif`;
  ctx.fillText(`${obj.v.toFixed(2)} m/s`, tipX + 8 / scaleFactor, tipY - 8 / scaleFactor);
  ctx.restore();
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
    const cosP = Math.cos(-obs.phi);
    const sinP = Math.sin(-obs.phi);
    // rotate click point into obstacle's local (unrotated) frame
    const lx = dx * cosP - dy * sinP;
    const ly = dx * sinP + dy * cosP;
    if ((lx * lx) / (obs.a * obs.a) + (ly * ly) / (obs.b * obs.b) <= 1) {
      return id;
    }
  }
  return null;
}

function drawAllObjects({ goals = {}, vehicles = {}, plannedTrajectories = {}, executionSamples = {}, obstacleIds = [], obstacles = {}, visibleTrajectories = {} } = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(offsetX, offsetY);
  ctx.scale(scaleFactor, scaleFactor);

  drawBackground();

  for (const name in goals) {
    const g = goals[name];
    const v = vehicles[name];
    if (!v) continue;
    drawGoal(g, v.color, v.id, name === selectedVehicle);
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
    drawObstacle(obs, id, id === selectedObstacle);
  }

  for (const name in vehicles) {
    const v = vehicles[name];
    drawVehicle(v, name === selectedVehicle);
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

function beginDrag(event, obstacles, selectedObstacle, vehicles, selectedVehicle) {
  if (event.altKey) {
    isDragging = true;
    dragStart.x = event.clientX - offsetX;
    dragStart.y = event.clientY - offsetY;
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const cx = event.clientX - rect.left;
  const cy = event.clientY - rect.top;

  if (selectedObstacle) {
    const obs = obstacles[selectedObstacle];
    const handle = findHandleAt(cx, cy, obs);
    if (handle) {
      handleDragMode = handle;
      handleDragObstacleId = selectedObstacle;
      handleDragOccurred = true;
      return;
    }
  }

  if (selectedVehicle) {
    const veh = vehicles[selectedVehicle];
    const handle = findVehicleHandleAt(cx, cy, veh);
    if (handle) {
      handleDragMode = handle;
      handleDragVehicleId = selectedVehicle;
      handleDragOccurred = true;
    }
  }
}

function dragCanvas(event, obstacles, vehicles, goals) {
  if (isDragging) {
    offsetX = event.clientX - dragStart.x;
    offsetY = event.clientY - dragStart.y;
    return;
  }

  if (handleDragMode && handleDragObstacleId) {
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const { E, N } = canvasToWorld(cx, cy);

    const obs = obstacles[handleDragObstacleId];
    const dx = E - obs.E;
    const dy = N - obs.N;

    if (handleDragMode === 'handleA') {
      obs.a = Math.max(0.5, Math.hypot(dx, dy));
      obs.phi = Math.atan2(dy, dx);
    } else if (handleDragMode === 'handleB') {
      const perpX = -Math.sin(obs.phi);
      const perpY = Math.cos(obs.phi);
      const proj = dx * perpX + dy * perpY;
      obs.b = Math.max(0.5, Math.abs(proj));
    }
    //drawScene();
    return;
  }

  if (handleDragMode === 'vehicleArrow' && handleDragVehicleId) {
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const px = (cx - offsetX) / scaleFactor;
    const py = (cy - offsetY) / scaleFactor;

    const veh = vehicles[handleDragVehicleId];
    const { cx: ocx, cy: ocy } = worldToCanvas(veh.E, veh.N);
    const dx = px - ocx;
    const dy = py - ocy;

    veh.yaw = Math.atan2(dy, dx);
    veh.v = Math.max(0, Math.hypot(dx, dy) / (VELOCITY_ARROW_SCALE * scale));
  }

   if (handleDragMode === 'goalArrow' && handleDragGoalId) {
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;

    const px = (cx - offsetX) / scaleFactor;
    const py = (cy - offsetY) / scaleFactor;

    const goal = goals[handleDragGoalId];
    const { cx: ocx, cy: ocy } = worldToCanvas(goal.E, goal.N);

    const dx = px - ocx;
    const dy = py - ocy;

    goal.yaw = Math.atan2(dy, dx);
    goal.v = Math.max(
      0,
      Math.hypot(dx, dy) / (VELOCITY_ARROW_SCALE * scale)
    );
  }
}

function beginDragRightClick(event, goals, selectedGoal) {
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;

    const goal = goals[selectedGoal];
    if (!goal) return;

    const handle = findGoalHandleAt(cx, cy, goal);

    if (handle) {
        handleDragMode = handle;          // "goalArrow"
        handleDragGoalId = selectedGoal;
        handleDragOccurred = true;
    }
}

function endDrag(obstacles, vehicles) {
  isDragging = false;

  handleDragMode = null;
  handleDragObstacleId = null;
  handleDragVehicleId = null;
  handleDragGoalId = null;
}

function findHandleAt(cx, cy, obs) {
  // Undo the ctx.translate(offsetX, offsetY) + ctx.scale(scaleFactor) transform
  // to bring the raw mouse pixel into the same "canvas space" that worldToCanvas produces
  const px = (cx - offsetX) / scaleFactor;
  const py = (cy - offsetY) / scaleFactor;

  const { cx: ocx, cy: ocy } = worldToCanvas(obs.E, obs.N);
  const screenPhi = -obs.phi;

  const ax = ocx + Math.cos(screenPhi) * obs.a * scale;
  const ay = ocy + Math.sin(screenPhi) * obs.a * scale;
  if (Math.hypot(px - ax, py - ay) < 16 / scaleFactor) return 'handleA';

  const bx = ocx - Math.sin(screenPhi) * obs.b * scale;
  const by = ocy + Math.cos(screenPhi) * obs.b * scale;
  if (Math.hypot(px - bx, py - by) < 16 / scaleFactor) return 'handleB';

  return null;
}

function setHandleDragOccurred(value) {
  handleDragOccurred = value;
}

function findVehicleHandleAt(cx, cy, veh) {
  const px = (cx - offsetX) / scaleFactor;
  const py = (cy - offsetY) / scaleFactor;

  const { cx: ocx, cy: ocy } = worldToCanvas(veh.E, veh.N);
  const screenYaw = veh.yaw;

  const armLength = Math.max(veh.v, 0.01) * VELOCITY_ARROW_SCALE * scale;
  const tipX = ocx + Math.cos(screenYaw) * armLength;
  const tipY = ocy + Math.sin(screenYaw) * armLength;

  if (Math.hypot(px - tipX, py - tipY) < 16 / scaleFactor) return 'vehicleArrow';
  return null;
}

function findGoalHandleAt(cx, cy, goal) {
  const px = (cx - offsetX) / scaleFactor;
  const py = (cy - offsetY) / scaleFactor;

  const { cx: ocx, cy: ocy } = worldToCanvas(goal.E, goal.N);
  const screenYaw = goal.yaw;

  const armLength = Math.max(goal.v, 0.01) * VELOCITY_ARROW_SCALE * scale;
  const tipX = ocx + Math.cos(screenYaw) * armLength;
  const tipY = ocy + Math.sin(screenYaw) * armLength;

  if (Math.hypot(px - tipX, py - tipY) < 16 / scaleFactor) return 'goalArrow';
  return null;
}

export {
  initCanvas,
  drawAllObjects,
  centerEasting,
  centerNorthing,
  handleDragOccurred,
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
  beginDragRightClick,
  setHandleDragOccurred,
  endDrag
};
