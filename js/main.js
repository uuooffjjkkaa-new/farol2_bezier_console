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
  centerEasting,
  centerNorthing,
  handleDragOccurred,
  setHandleDragOccurred,
  canvasToWorld,
  findVehicleAt,
  findGoalAt,
  findObstacleAt,
  zoomCanvas,
  beginDrag,
  dragCanvas,
  beginDragRightClick,
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
  populatePlannerConfig,
  clearSelectedVehicles,
  deselectVehicle
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
// let nextVehicleId = 0;
let isExecutingMission = false;
let sim_active_flag = false;

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

function isUsingSimState() {
  return document.getElementById('useSimState').checked;
}


function smallestFreeVehicleIndex() {
  let i = 0;
  while (`mred${i}` in vehicles) i++;
  return i;
}

function addVehicleAtCenter() {
  const idx = smallestFreeVehicleIndex();
  const id = `mred${idx}`;
  vehicles[id] = {
    E: centerEasting,
    N: centerNorthing,
    yaw: 0.0,
    v: 0.01,
    color: vehicleColor(id),
    id: idx
  };
  setSelectedVehicleInternal(id);
  setSelectedObstacleInternal(null);
  if (!knownVehicles.includes(id)) knownVehicles.push(id);
  knownVehicles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  updateVehicleCheckboxUI();
  setStage('stageOptimization', 'pending');
  drawScene();
  saveMapState({ vehicles, obstacles, goals });
}

function syncLoadedMapState() {
  const saved = loadMapState();
  Object.assign(obstacles, saved.obstacles || {});
  Object.assign(goals, saved.goals || {});
  Object.assign(vehicles, saved.vehicles || {});

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
  if (isUsingSimState()) {
    if (!sim_active_flag) {
      removeAllVehicles();
      sim_active_flag = true;
    }

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
  else {
    if (sim_active_flag) {
      removeAllVehicles();
      sim_active_flag = false;
    }

    Object.keys(vehicles).forEach((name) => {
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
        subscribedVehicles.add(name);
      }
    });

    updateVehicleCheckboxUI();
  
  }
}

function handleCanvasClick(event) {
    if (event.altKey) return;
    if (handleDragOccurred) {
        setHandleDragOccurred(false);
        return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const { E, N } = canvasToWorld(cx, cy);

    const clickedVehicle = findVehicleAt(E, N, vehicles);
    const clickedGoal = findGoalAt(E, N, goals);
    const clickedObstacle = findObstacleAt(E, N, obstacles, obstacleIds);


    if (clickedVehicle) {
        setSelectedVehicleInternal(clickedVehicle);
        setSelectedObstacleInternal(null);
        if (isUsingSimState()) {
            sendStateToVehicle(clickedVehicle, vehicles[clickedVehicle]);
        }
        drawScene();
        return;
    }

    if (clickedGoal) {
        setSelectedVehicleInternal(clickedGoal);
        setSelectedObstacleInternal(null);
        if (isUsingSimState()) {
            sendStateToVehicle(clickedGoal, vehicles[clickedGoal]);
        }
        drawScene();
        return;
    }

    if (clickedObstacle) {
        setSelectedObstacleInternal(clickedObstacle);
        setSelectedVehicleInternal(null);
        drawScene();
        return;
    }


    if (selectedVehicle) {
        const v = vehicles[selectedVehicle];
        if (v) {
            v.E = E;
            v.N = N;
            drawScene();
            saveMapState({ vehicles, obstacles, goals });
        }
        sendStateToVehicle(selectedVehicle, v);
        return;
    }

    if (selectedObstacle) {
        const obs = obstacles[selectedObstacle];
        if (obs) {
            obs.E = E;
            obs.N = N;
            setStage('stageObstacle', 'pending');
            drawScene();
            saveMapState({ vehicles, obstacles, goals });
        }
        sendObstacleData();
    }
}

function handleCanvasRightClick(event) {
    event.preventDefault(); // stop the browser context menu

    if (event.altKey) return;
    if (selectedVehicle == null) return;

    // First, see if we're starting a drag on an existing goal
    beginDragRightClick(event, goals, selectedVehicle);

    if (handleDragOccurred) {
        // A drag has been initiated, don't place a new goal.
        return;
    }

    // Otherwise perform the existing "place goal" action
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const { E, N } = canvasToWorld(cx, cy);

    const previousGoal = goals[selectedVehicle];

    goals[selectedVehicle] = {
        E,
        N,
        yaw: previousGoal?.yaw ?? 0,
        v: previousGoal?.v ?? 0.01
    };

    drawScene();
    saveMapState({ vehicles, obstacles, goals });

    sendGoalToVehicle(selectedVehicle, goals[selectedVehicle])
        .then(true)
        .catch((err) => console.error('Goal send failed', err));
}

function handleCanvasWheel(event) {
  zoomCanvas(event);
  drawScene();
}

function handleCanvasMouseDown(event) {
  beginDrag(event, obstacles, selectedObstacle, vehicles, selectedVehicle);
 }

function handleCanvasMouseMove(event) {
  dragCanvas(event, obstacles, vehicles, goals);
  if (event.altKey) {
    drawScene();
  } else if (handleDragOccurred){
    drawScene();
    setStage('stageObstacle', 'pending');
  }

}

function handleCanvasMouseUp() {
  endDrag(obstacles, vehicles);
  sendObstacleData();
  if (selectedVehicle) {
    sendStateToVehicle(selectedVehicle, vehicles[selectedVehicle]);
    sendGoalToVehicle(selectedVehicle, goals[selectedVehicle])
  }
  saveMapState({ vehicles, obstacles, goals });
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
    const id = `obs${nextObstacleId}`;
    nextObstacleId += 1;
    obstacles[id] = {
        E: centerEasting,
        N: centerNorthing,
        a: 4.0,
        b: 4.0,
        phi: 0,                       // radians
        color: 'gray'
    };
    obstacleIds.push(id);
    setSelectedObstacleInternal(id);
    setSelectedVehicleInternal(null);
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
  sendObstacleData();
}

function removeAllObstacles() {
    obstacleIds.forEach((id) => {
        delete obstacles[id];
    });
    obstacleIds.length = 0;
    nextObstacleId = 0;
    setSelectedObstacleInternal(null);
    setStage('stageObstacle', 'pending');
    drawScene();
    sendObstacleData();
}

function purgeVehicle(id) {
  delete vehicles[id];
  delete goals[id];
  delete plannedTrajectories[id];
  delete executionSamples[id];
  visibleTrajectories.delete(id);
  deselectVehicle(id);
  const k = knownVehicles.indexOf(id);
  if (k !== -1) knownVehicles.splice(k, 1);
}

function removeVehicle() {
  if (!selectedVehicle) {
    alert('No vehicle is currently selected.');
    return;
  }
  purgeVehicle(selectedVehicle);
  setSelectedVehicleInternal(null);
  updateVehicleCheckboxUI();
  drawScene();
  saveMapState({ vehicles, obstacles, goals });
}

function removeAllVehicles() {
  Object.keys(vehicles).forEach(purgeVehicle);
  knownVehicles.length = 0;
  setSelectedVehicleInternal(null);
  updateVehicleCheckboxUI();
  drawScene();
  saveMapState({ vehicles, obstacles, goals });
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
  const selected = getSelectedVehicles().filter((n) => n in vehicles);
  selected.forEach((name) => visibleTrajectories.add(name));
  drawScene();
}

function removeTrajectoriesForSelectedVehicles() {
  const selected = getSelectedVehicles().filter((n) => n in vehicles);
  selected.forEach((name) => visibleTrajectories.delete(name));
  drawScene();
}

function deployMission() {
  const selected = getSelectedVehicles().filter((n) => n in vehicles);
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
  const selected = getSelectedVehicles().filter((n) => n in vehicles);
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
  console.log('constr_flags being sent:', JSON.stringify(bezier.constr_flags));
  const { bounds, gains } = getBoundsAndGainsFromUI();
  applyChanges({
    bezierParams: bezier,
    boundParams: bounds,
    gains
  }, {
    // onBezierSuccess: (result) => addLog(`Bezier params set: ${result.message}`),
    onBezierError: (err) => console.error('Bezier params error', err),
    // onBoundsSuccess: (result) => addLog(`Bounds set: ${result.message}`),
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
    onRightClick: handleCanvasRightClick,
    onWheel: handleCanvasWheel,
    onMouseDown: handleCanvasMouseDown,
    onMouseMove: handleCanvasMouseMove,
    onMouseUp: handleCanvasMouseUp
  });

  initUI({
    onApplyGoal: applyGoalParamsFromUI,
    onAddObstacle: addObstacleAtCenter,
    onRemoveObstacle: removeObstacle,
    onRemoveAllObstacles: removeAllObstacles,
    onAddVehicle: addVehicleAtCenter,
    onRemoveVehicle: removeVehicle,
    onRemoveAllVehicles: removeAllVehicles,
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
