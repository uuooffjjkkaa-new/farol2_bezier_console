/**
 * MotionPlanningConsole main module.
 *
 * Connects ROS, canvas rendering, UI controls, and planning services.
 */

import {
  initRosConnections,
  buildVehicleNamesFromRawTopics,
  subscribeToMissionLog,
  subscribePlanningAlive,
  subscribePlannerMissionOutput,
  subscribeMissionString,
  subscribePlannedTrajectory,
  subscribeVehicleState
} from './ros.js';

import {
  initCanvas,
  drawAllObjects,
  canvasToWorld,
  findVehicleAt,
  findObstacleAt,
  zoomCanvas,
  beginDrag,
  dragCanvas,
  endDrag,
  setSelectedVehicle,
  setSelectedObstacle
} from './canvas.js';

import {
  deployMissionWithProgress,
  startCPFForSelectedVehicles,
  stopCPFForSelectedVehicles,
  startPFForSelectedVehicles,
  stopPFForSelectedVehicles,
  sendGoalToVehicle,
  sendStateToVehicle,
  sendObstacles,
  runOptimization,
  cancelOptimization,
  applyChanges,
  loadPlannerConfig,
  executionSamples
} from './planning.js';

import {
  initUI,
  addLog,
  setStage,
  updateVehicleCheckboxList,
  getSelectedVehicles,
  getGoalParamsFromUI,
  getObstacleRadius,
  getBezierParamsFromUI,
  getBoundsAndGainsFromUI,
  populatePlannerConfig
} from './ui.js';

import {
  saveMapState,
  loadMapState,
  vehicleColor,
  vehicleNumber
} from './utils.js';

const vehicles = {};
const goals = {};
const goalParams = {};
const obstacles = {};
const obstacleIds = [];
const plannedTrajectories = {};
const visibleTrajectories = new Set();
const subscribedVehicles = new Set();
const SAMPLE_DT_MS = 200;

let selectedVehicle = null;
let selectedObstacle = null;
let knownVehicles = [];
let rosConnections = [];
let lastPlanningHeartbeat = Date.now();
let nextObstacleId = 0;
let isExecutingMission = false;

function drawScene() {
  drawAllObjects({
    goals,
    vehicles,
    plannedTrajectories,
    executionSamples,
    obstacleIds,
    obstacles,
    visibleTrajectories
  });
}

function updateVehicleCheckboxUI() {
  updateVehicleCheckboxList(knownVehicles, () => {
    drawScene();
  });
}

function syncLoadedMapState() {
  const saved = loadMapState();
  Object.assign(obstacles, saved.obstacles || {});
  Object.assign(goals, saved.goals || {});

  obstacleIds.length = 0;
  Object.keys(obstacles).forEach((id) => {
    obstacleIds.push(id);
  });
}

function setSelectedVehicleInternal(name) {
  selectedVehicle = name;
  setSelectedVehicle(name);
}

function setSelectedObstacleInternal(id) {
  selectedObstacle = id;
  setSelectedObstacle(id);
}

function refreshVehicleList() {
  rosConnections.forEach((ros) => {
    ros.getTopicsAndRawTypes((result) => {
      const allTopics = result.topics || [];
      const currentVehicles = buildVehicleNamesFromRawTopics(allTopics);

      const changed = currentVehicles.length !== knownVehicles.length ||
        !currentVehicles.every((name) => knownVehicles.includes(name));

      if (!changed) return;

      currentVehicles.forEach((name) => {
        if (!knownVehicles.includes(name)) knownVehicles.push(name);
        if (!vehicles[name]) {
          vehicles[name] = {
            E: 0,
            N: 0,
            yaw: 0,
            v: 0,
            color: vehicleColor(name),
            id: vehicleNumber(name)
          };
        }

        if (!subscribedVehicles.has(name)) {
          subscribePlannedTrajectory((msg) => {
            plannedTrajectories[name] = msg.poses.map((pose) => ({
              E: pose.pose.position.y,
              N: pose.pose.position.x
            }));
            visibleTrajectories.add(name);
            setStage('stageOptimization', 'completed');
            drawScene();
          })(name);

          subscribePlannerMissionOutput(name, () => {
            addLog(`Mission received for ${name}`);
          });

          subscribeVehicleState(ros, name, (msg) => {
            vehicles[name].E = msg.x;
            vehicles[name].N = msg.y;
            vehicles[name].yaw = (msg.yaw * Math.PI / 180) - Math.PI / 2;
            vehicles[name].v = msg.u;
            drawScene();
          });

          subscribedVehicles.add(name);
        }
      });

      updateVehicleCheckboxUI();
    });
  });
}

function handleCanvasClick(event) {
  if (event.altKey) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const cx = event.clientX - rect.left;
  const cy = event.clientY - rect.top;
  const { E, N } = canvasToWorld(cx, cy);

  const clickedVehicle = findVehicleAt(E, N, vehicles);
  const clickedObstacle = findObstacleAt(E, N, obstacles, obstacleIds);

  if (clickedVehicle) {
    setSelectedVehicleInternal(clickedVehicle);
    setSelectedObstacleInternal(null);
    sendStateToVehicle(clickedVehicle, vehicles[clickedVehicle]);
    return;
  }

  if (clickedObstacle) {
    setSelectedObstacleInternal(clickedObstacle);
    setSelectedVehicleInternal(null);
    return;
  }

  if (selectedVehicle) {
    const params = goalParams[selectedVehicle] || { theta: 0, v: 0.01 };
    goals[selectedVehicle] = { E, N, theta: params.theta };
    sendGoalToVehicle(selectedVehicle, E, N, params)
      .then(() => addLog(`Goal sent to ${selectedVehicle}`))
      .catch((err) => console.error('Goal send failed', err));
    saveMapState({ obstacles, goals });
  }

  if (selectedObstacle) {
    const obs = obstacles[selectedObstacle];
    if (obs) {
      obs.E = E;
      obs.N = N;
      setStage('stageObstacle', 'pending');
      drawScene();
      saveMapState({ obstacles, goals });
    }
  }
}

function handleCanvasWheel(event) {
  zoomCanvas(event);
  drawScene();
}

function handleCanvasMouseDown(event) {
  beginDrag(event);
 }

function handleCanvasMouseMove(event) {
  dragCanvas(event);
  if (event.altKey) drawScene();
}

function handleCanvasMouseUp() {
  endDrag();
}

function applyGoalParamsFromUI() {
  if (!selectedVehicle) {
    alert('No vehicle selected');
    return;
  }
  goalParams[selectedVehicle] = getGoalParamsFromUI();
  console.log(`Goal params set for ${selectedVehicle}:`, goalParams[selectedVehicle]);
}

function addObstacleAtCenter() {
  const radius = getObstacleRadius();
  const id = `obs${nextObstacleId}`;
  nextObstacleId += 1;
  obstacles[id] = {
    E: 491899,
    N: 4290842,
    radius,
    color: 'gray'
  };
  obstacleIds.push(id);
  setSelectedObstacleInternal(id);
  setStage('stageObstacle', 'pending');
  drawScene();
}

function removeObstacle() {
  if (!selectedObstacle) {
    alert('No obstacle is currently selected.');
    return;
  }
  delete obstacles[selectedObstacle];
  const index = obstacleIds.indexOf(selectedObstacle);
  if (index !== -1) obstacleIds.splice(index, 1);
  setSelectedObstacleInternal(null);
  setStage('stageObstacle', 'pending');
  drawScene();
}

function sendObstacleData() {
  sendObstacles(obstacleIds, obstacles, {
    onSuccess: (res) => {
      console.log('SetObstacles response:', res);
      alert(res.message);
      setStage('stageObstacle', 'completed');
    },
    onError: (err) => {
      console.error('Error calling SetObstacles:', err);
      alert('Failed to send obstacles. See console.');
    }
  });
}

function addTrajectoriesForSelectedVehicles() {
  const selected = getSelectedVehicles();
  selected.forEach((name) => visibleTrajectories.add(name));
  drawScene();
}

function removeTrajectoriesForSelectedVehicles() {
  const selected = getSelectedVehicles();
  selected.forEach((name) => visibleTrajectories.delete(name));
  drawScene();
}

function deployMission() {
  const selected = getSelectedVehicles();
  if (!selected.length) {
    alert('Please select at least one vehicle.');
    return;
  }

  isExecutingMission = true;
  deployMissionWithProgress(selected, {
    onProgress: (progress) => {
      const progressEl = document.getElementById('executionProgress');
      if (progressEl) progressEl.style.width = `${progress * 100}%`;
    },
    onStarted: (name, url) => addLog(`Mission published for ${name} on ${url}`),
    onCompleted: () => {
      addLog('Mission execution completed');
      isExecutingMission = false;
    },
    onWarning: (message) => addLog(message),
    onError: (message) => addLog(`Mission error: ${message}`),
    onStage: (state) => setStage('stageExecuting', state)
  });
}

function runOptimizationHandler() {
  const selected = getSelectedVehicles();
  runOptimization(selected, {
    onStarted: () => setStage('stageOptimization', 'running'),
    onSuccess: (res) => {
      alert(res.message);
      setStage('stageOptimization', res.success ? 'success' : 'error');
    },
    onError: (err) => {
      console.error('Optimization failed', err);
      alert('Optimization service call failed. See console.');
      setStage('stageOptimization', 'error');
    },
    onStage: (state) => setStage('stageOptimization', state)
  });
}

function cancelOptimizationHandler() {
  cancelOptimization({
    onSuccess: (res) => {
      console.log(res.message);
      alert(res.message);
      setStage('stageOptimization', 'idle');
    },
    onError: (err) => {
      console.error('Cancel failed', err);
      alert('Cancel service failed. See console.');
    }
  });
}

function loadPlannerConfigHandler() {
  loadPlannerConfig({
    onLoaded: (result) => {
      populatePlannerConfig(result);
      addLog('Planner config loaded from solver.');
    },
    onError: (err) => {
      console.error('Load planner config failed', err);
      alert('Failed to load planner config. See console.');
    }
  });
}

function applyChangesHandler() {
  const bezier = getBezierParamsFromUI();
  const { bounds, gains } = getBoundsAndGainsFromUI();
  applyChanges({
    bezierParams: {
      bezierDegree: bezier.degree,
      guessDegree: bezier.guessDegree,
      nSplit: bezier.nSplit,
      constrFlags: bezier.constrFlags
    },
    boundParams: bounds,
    gains
  }, {
    onBezierSuccess: (result) => addLog(`Bezier params set: ${result.message}`),
    onBezierError: (err) => console.error('Bezier params error', err),
    onBoundsSuccess: (result) => addLog(`Bounds set: ${result.message}`),
    onBoundsError: (err) => console.error('Bounds error', err)
  });
}

function clearInlineHandlers() {
  document.querySelectorAll('[onclick]').forEach((element) => {
    element.removeAttribute('onclick');
  });
}

function initApp() {
  rosConnections = initRosConnections();
  initCanvas({
    onClick: handleCanvasClick,
    onWheel: handleCanvasWheel,
    onMouseDown: handleCanvasMouseDown,
    onMouseMove: handleCanvasMouseMove,
    onMouseUp: handleCanvasMouseUp
  });

  initUI({
    onApplyGoal: applyGoalParamsFromUI,
    onAddObstacle: addObstacleAtCenter,
    onRemoveObstacle: removeObstacle,
    onSendObstacles: sendObstacleData,
    onAddTrajectories: addTrajectoriesForSelectedVehicles,
    onRemoveTrajectories: removeTrajectoriesForSelectedVehicles,
    onRunOptimization: runOptimizationHandler,
    onCancelOptimization: cancelOptimizationHandler,
    onStartCPF: () => startCPFForSelectedVehicles(getSelectedVehicles(), {
      onStarted: (vehicle, url) => addLog(`CPF started for ${vehicle} on ${url}`),
      onError: (vehicle, url, err) => console.error(`CPF start failed for ${vehicle}`, err)
    }),
    onStopCPF: () => stopCPFForSelectedVehicles(getSelectedVehicles(), {
      onStopped: (vehicle, url) => addLog(`CPF stopped for ${vehicle} on ${url}`),
      onError: (vehicle, url, err) => console.error(`CPF stop failed for ${vehicle}`, err)
    }),
    onStartPF: () => startPFForSelectedVehicles(getSelectedVehicles(), {
      onStarted: (vehicle, url) => addLog(`PF started for ${vehicle} on ${url}`),
      onError: (vehicle, url, err) => console.error(`PF start failed for ${vehicle}`, err)
    }),
    onStopPF: () => stopPFForSelectedVehicles(getSelectedVehicles(), {
      onStopped: (vehicle, url) => addLog(`PF stopped for ${vehicle} on ${url}`),
      onError: (vehicle, url, err) => console.error(`PF stop failed for ${vehicle}`, err)
    }),
    onDeployMission: deployMission,
    onLoadPlannerConfig: loadPlannerConfigHandler,
    onApplyChanges: applyChangesHandler
  });

  clearInlineHandlers();
  syncLoadedMapState();
  drawScene();

  subscribeToMissionLog((message) => addLog(message));

  subscribePlanningAlive(() => {
    lastPlanningHeartbeat = Date.now();
    setStage('stagePlanning', 'completed');
  });

  setInterval(() => {
    if (Date.now() - lastPlanningHeartbeat > 4000) {
      setStage('stagePlanning', 'pending');
    }
  }, 500);

  setInterval(() => {
    refreshVehicleList();
  }, 2000);

  setInterval(() => {
    if (!Object.keys(vehicles).length) return;
    if (!isExecutingMission) return;

    Object.entries(vehicles).forEach(([id, vehicle]) => {
      executionSamples[id] = executionSamples[id] || [];
      executionSamples[id].push({ E: vehicle.E, N: vehicle.N, t: performance.now() });
    });

    drawScene();
  }, SAMPLE_DT_MS);
}

window.addEventListener('DOMContentLoaded', initApp);
