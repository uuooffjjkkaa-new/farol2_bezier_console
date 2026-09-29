/**
 * MotionPlanningConsole UI helper module.
 *
 * Contains DOM helpers for tabs, selection lists, logs, and form value extraction.
 */

import { parseNumber } from './utils.js';

const selectedVehiclesSet = new Set();

function initUI({
  onTabOpen,
  onApplyGoal,
  onAddObstacle,
  onRemoveObstacle,
  onRemoveAllObstacles,
  onAddVehicle,
  onRemoveVehicle,
  onRemoveAllVehicles,
  onSendObstacles,
  onAddTrajectories,
  onRemoveTrajectories,
  onRunOptimization,
  onCancelOptimization,
  onStartCPF,
  onStopCPF,
  onStartPF,
  onStopPF,
  onDeployMission,
  onLoadPlannerConfig,
  onApplyChanges
} = {}) {
  document.querySelectorAll('.tabBtn').forEach((button) => {
    button.addEventListener('click', (event) => {
      const tabId = button.dataset.tab;
      if (tabId) openTab(tabId, event);
      onTabOpen?.(tabId);
    });
  });

  const actionMap = {
    applyGoal: onApplyGoal,
    addObstacle: onAddObstacle,
    removeObstacle: onRemoveObstacle,
    addVehicle: onAddVehicle,
    removeVehicle: onRemoveVehicle,
    removeAllObstacles: onRemoveAllObstacles,
    removeAllVehicles: onRemoveAllVehicles,
    sendObstacles: onSendObstacles,
    addTrajectories: onAddTrajectories,
    removeTrajectories: onRemoveTrajectories,
    runOptimization: onRunOptimization,
    cancelOptimization: onCancelOptimization,
    startCPF: onStartCPF,
    stopCPF: onStopCPF,
    startPF: onStartPF,
    stopPF: onStopPF,
    deployMission: onDeployMission,
    loadPlannerConfig: onLoadPlannerConfig,
    applyChanges: onApplyChanges
  };

  document.querySelectorAll('[data-action]').forEach((element) => {
    const action = element.dataset.action;
    const callback = actionMap[action];
    if (typeof callback === 'function') {
      element.addEventListener('click', callback);
    }
  });
}

function openTab(tabId, event) {
  const contents = document.getElementsByClassName('tabContent');
  const buttons = document.getElementsByClassName('tabBtn');

  Array.from(contents).forEach((content) => content.classList.remove('activeContent'));
  Array.from(buttons).forEach((button) => button.classList.remove('activeTab'));

  const selected = document.getElementById(tabId);
  if (selected) selected.classList.add('activeContent');
  if (event?.currentTarget) event.currentTarget.classList.add('activeTab');
}

function addLog(message) {
  const logs = document.querySelectorAll('.nodeLog');
  if (!logs.length) return;

  const text = `[${new Date().toLocaleTimeString()}] ${message}`;
  logs.forEach(log => {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = text;
    log.appendChild(entry);
    log.parentElement.scrollTop = log.parentElement.scrollHeight;
  });
}

function setStage(stageId, state) {
  const stages = document.querySelectorAll(`.${stageId}`);
  if (!stages.length) return;
  stages.forEach(stage => {
    stage.classList.remove('completed', 'running', 'error', 'idle');
    stage.classList.add(state);
  });
}

function updateVehicleCheckboxList(vehicleNames, onSelectionChange) {
  const containers = document.querySelectorAll('.vehicleList');
  if (!containers.length) return;

  containers.forEach(container => {
    container.innerHTML = '';

    vehicleNames.forEach((name) => {
      const div = document.createElement('div');
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.marginRight = '12px';

      const label = document.createElement('label');
      label.style.marginRight = '6px';
      label.textContent = name;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.vehicle = name;
      checkbox.checked = selectedVehiclesSet.has(name);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedVehiclesSet.add(name);
        else selectedVehiclesSet.delete(name);

        // keep the copies in the other tab in sync
        document.querySelectorAll('.vehicleList input[type="checkbox"]').forEach(other => {
          if (other.dataset.vehicle === name) other.checked = checkbox.checked;
        });

        onSelectionChange?.(Array.from(selectedVehiclesSet));
      });

      div.appendChild(label);
      div.appendChild(checkbox);
      container.appendChild(div);
    });
  });
}

function getSelectedVehicles() {
  return Array.from(selectedVehiclesSet);
}

function getGoalParamsFromUI() {
  const theta = parseNumber(document.getElementById('goal_theta')?.value, 0);
  const v = parseNumber(document.getElementById('goal_v')?.value, 0.01);
  return { theta, v };
}

function getObstacleRadius() {
  return parseNumber(document.getElementById('obstacleRadius')?.value, 2);
}

function getBezierParamsFromUI() {
  return {
    bezier_degree: parseInt(document.getElementById('bezierDegree').value),
    guess_degree: parseInt(document.getElementById('guessDegree').value),
    n_split: Array.from(document.querySelectorAll('#nSplitInputs input')).map(input => parseInt(input.value, 10)),
    constr_flags: Array.from({length: 4}, (_, i) => document.getElementById(`c${i}`).checked)
  };
}

function getBoundsAndGainsFromUI() {
  return {
    bounds: {
      vel_min: parseNumber(document.getElementById('vel_min')?.value, 0),
      vel_max: parseNumber(document.getElementById('vel_max')?.value, 0),
      acc_min: parseNumber(document.getElementById('acc_min')?.value, 0),
      acc_max: parseNumber(document.getElementById('acc_max')?.value, 0),
      ang_vel_min: parseNumber(document.getElementById('ang_vel_min')?.value, 0),
      ang_vel_max: parseNumber(document.getElementById('ang_vel_max')?.value, 0),
      ang_acc_min: parseNumber(document.getElementById('ang_acc_min')?.value, 0),
      ang_acc_max: parseNumber(document.getElementById('ang_acc_max')?.value, 0),
      obs_min: parseNumber(document.getElementById('obs_min')?.value, 0),
      obs_max: parseNumber(document.getElementById('obs_max')?.value, 0),
      radius: parseNumber(document.getElementById('radius')?.value, 1.5)
    },
    gains: {
      alpha: parseNumber(document.getElementById('alpha')?.value, 1),
      beta: parseNumber(document.getElementById('beta')?.value, 1),
      gamma: parseNumber(document.getElementById('gamma')?.value, 1)
    }
  };
}

function populatePlannerConfig(config) {
  if (!config) return;
  document.getElementById('vel_min').value = config.vel_min;
  document.getElementById('vel_max').value = config.vel_max;
  document.getElementById('acc_min').value = config.acc_min;
  document.getElementById('acc_max').value = config.acc_max;
  document.getElementById('ang_vel_min').value = config.ang_vel_min;
  document.getElementById('ang_vel_max').value = config.ang_vel_max;
  document.getElementById('ang_acc_min').value = config.ang_acc_min;
  document.getElementById('ang_acc_max').value = config.ang_acc_max;
  document.getElementById('obs_min').value = config.obs_min;
  document.getElementById('obs_max').value = config.obs_max;
  document.getElementById('radius').value = config.radius;
  document.getElementById('alpha').value = config.alpha;
  document.getElementById('beta').value = config.beta;
  document.getElementById('gamma').value = config.gamma;
  document.getElementById('bezierDegree').value = config.bezier_degree;
  document.getElementById('guessDegree').value = config.guess_degree;

  const splitInputs = document.querySelectorAll('#nSplitInputs input');
  splitInputs.forEach((input, idx) => {
    input.value = config.nSplit?.[idx] ?? 1;
  });

  document.getElementById('c0').checked = !!config.constr_flags?.[0];
  document.getElementById('c1').checked = !!config.constr_flags?.[1];
  document.getElementById('c2').checked = !!config.constr_flags?.[2];
  document.getElementById('c3').checked = !!config.constr_flags?.[3];
}

function deselectVehicle(name) {
  selectedVehiclesSet.delete(name);
}

function clearSelectedVehicles() {
  selectedVehiclesSet.clear();
}

export {
  initUI,
  openTab,
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
};
