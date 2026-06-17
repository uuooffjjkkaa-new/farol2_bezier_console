/**
 * MotionPlanningConsole planning helper module.
 *
 * This module contains motion-planning service calls, mission deployment,
 * CPF/PF controls, and helper wrappers around ROS service requests.
 */

import {
  rosConnections,
  ensureMissionAddonTopic,
  missionStrings,
  callService,
  callServiceAsync,
  getRosConnection,
  createTopic,
  createRosInstance,
  createService
} from './ros.js';

let isExecutingMission = false;
const executionSamples = {};
const executionSubscribers = new Map();

function deployMissionWithProgress(selectedVehicles, { onProgress, onStarted, onCompleted, onWarning, onError, onStage } = {}) {
  if (!Array.isArray(selectedVehicles) || selectedVehicles.length === 0) {
    onWarning?.('No vehicles selected.');
    return;
  }

  isExecutingMission = true;
  selectedVehicles.forEach((vehicleId) => {
    executionSamples[vehicleId] = [];
  });

  subscribeExecutionProgress(selectedVehicles, {
    onProgress,
    onCompleted,
    onReset: () => {
      onStage?.('pending');
      if (document && document.getElementById) {
        const progressEl = document.getElementById('executionProgress');
        if (progressEl) progressEl.style.width = '0%';
      }
    }
  });

  rosConnections.forEach((ros) => {
    selectedVehicles.forEach((name) => {
      const missionTopic = ensureMissionAddonTopic(ros, name);
      const missionString = missionStrings[name];

      if (!missionTopic) {
        onError?.(`Mission topic not initialized for ${name} on ${ros.url}`);
        return;
      }

      if (!missionString) {
        onWarning?.(`No mission string available for ${name}`);
        return;
      }

      const msg = new window.ROSLIB.Message({ data: missionString });
      missionTopic.publish(msg);
      onStarted?.(name, ros.url);
    });
  });

  onStage?.('running');
}

function subscribeExecutionProgress(activeVehicles, { onProgress, onCompleted, onReset } = {}) {
  if (!Array.isArray(activeVehicles) || activeVehicles.length === 0) {
    return () => {};
  }

  const firstVehicle = activeVehicles[0];
  const topicName = `/${firstVehicle}/Gamma`;
  const statusTopicName = `/${firstVehicle}/Flag`;
  let lastExecutionHeartbeat = Date.now();
  let previousStatus = 0;
  const subscriptions = [];

  rosConnections.forEach((connection) => {
    const executionProgressTopic = createTopic({
      ros: connection,
      name: topicName,
      messageType: 'std_msgs/Float64'
    });

    const progressHandler = (msg) => {
      lastExecutionHeartbeat = Date.now();
      const progress = Math.min(Math.max(msg.data, 0), 1);
      onProgress?.(progress);

      if (progress > 0 && progress < 1) {
        onStage?.('running');
      }

      if (progress >= 1) {
        onStage?.('completed');
        isExecutingMission = false;
        executionProgressTopic.unsubscribe();
        statusTopic.unsubscribe();
        onCompleted?.();
      }
    };

    executionProgressTopic.subscribe(progressHandler);
    subscriptions.push(() => executionProgressTopic.unsubscribe());

    const statusTopic = createTopic({
      ros: connection,
      name: statusTopicName,
      messageType: 'std_msgs/Int8'
    });

    const statusHandler = (msg) => {
      const currentStatus = msg.data;
      if (previousStatus !== 0 && currentStatus === 0) {
        onStage?.('completed');
        isExecutingMission = false;
        executionProgressTopic.unsubscribe();
        statusTopic.unsubscribe();
        onCompleted?.();
      }
      previousStatus = currentStatus;
    };

    statusTopic.subscribe(statusHandler);
    subscriptions.push(() => statusTopic.unsubscribe());
  });

  const intervalId = window.setInterval(() => {
    if (Date.now() - lastExecutionHeartbeat > 2000) {
      onReset?.();
    }
  }, 500);

  subscriptions.push(() => window.clearInterval(intervalId));

  const unsubscribe = () => {
    subscriptions.forEach((fn) => fn());
  };

  executionSubscribers.set(activeVehicles.join(','), unsubscribe);
  return unsubscribe;
}
// TODO: Correct the cpf according to the new implementation
function startCPFForSelectedVehicles(selectedVehicles, { onStarted, onError } = {}) {
  return callStartStopService(selectedVehicles, 'CPFStart', 'cpf_control/StartStop', onStarted, onError);
}

function stopCPFForSelectedVehicles(selectedVehicles, { onStopped, onError } = {}) {
  return callStartStopService(selectedVehicles, 'CPFStop', 'cpf_control/StartStop', onStopped, onError);
}

function startPFForSelectedVehicles(selectedVehicles, { onStarted, onError } = {}) {
  return callStartStopService(selectedVehicles, 'control/path_following/Start', 'farol2_path_following/srv/StartPF', onStarted, onError);
}

function stopPFForSelectedVehicles(selectedVehicles, { onStopped, onError } = {}) {
  return callStartStopService(selectedVehicles, 'control/path_following/Stop', 'farol2_path_following/srv/StopPF', onStopped, onError);
}

function callStartStopService(selectedVehicles, serviceName, serviceType, onSuccess, onError) {
  if (!Array.isArray(selectedVehicles) || selectedVehicles.length === 0) {
    onError?.('No vehicles selected');
    return;
  }

  let completed = 0;
  const targetCount = selectedVehicles.length * rosConnections.length;

  rosConnections.forEach((ros) => {
    selectedVehicles.forEach((vehicle) => {
      const service = createService({ ros, name: `/${vehicle}/${serviceName}`, serviceType });
      service.callService(new window.ROSLIB.ServiceRequest(), () => {
        completed += 1;
        onSuccess?.(vehicle, ros.url);
        if (completed === targetCount) {
          onSuccess?.('all', ros.url);
        }
      }, (err) => {
        onError?.(vehicle, ros.url, err);
      });
    });
  });
}

function sendGoalToVehicle(vehicleName, E, N, goalParams = { theta: 0, v: 0.01 }) {
  const request = {
    vehicle_name: vehicleName,
    e: E,
    N: N,
    theta: (goalParams.theta ?? 0) * Math.PI / 180,
    v: goalParams.v ?? 0.01
  };

  return callServiceAsync('setGoal', request);
}

function sendStateToVehicle(vehicleName, vehicleState) {
  const request = {
    vehicle_name: vehicleName,
    e: vehicleState.E,
    n: vehicleState.N,
    theta: vehicleState.yaw + Math.PI / 2,
    v: vehicleState.v
  };

  return callServiceAsync('setStates', request);
}

function sendObstacles(obstacleIds, obstacles, { onSuccess, onError } = {}) {
  const circ_obs = obstacleIds
    .map((id) => {
      const obs = obstacles[id];
      return [obs.E, obs.N, obs.radius];
    })
    .flat();

  const request = {
    circ_obs,
    line_obs: []
  };

  callService('setObstacles', request, (res) => {
    onSuccess?.(res);
  }, (err) => {
    onError?.(err);
  });
}

function runOptimization(selectedVehicles, { onStarted, onSuccess, onError, onStage } = {}) {
  if (!Array.isArray(selectedVehicles) || selectedVehicles.length === 0) {
    onError?.('Please select at least one vehicle.');
    onStage?.('error');
    return;
  }

  isExecutingMission = false;

  const request = { vehicle_names: selectedVehicles };
  onStage?.('running');
  onStarted?.();

  callService('runOptimization', request, (res) => {
    onSuccess?.(res);
    onStage?.(res.success ? 'success' : 'error');
  }, (err) => {
    onError?.(err);
    onStage?.('error');
  });
}

function cancelOptimization({ onSuccess, onError, onStage } = {}) {
  isExecutingMission = false;
  const request = {};

  callService('cancelOptimization', request, (res) => {
    onSuccess?.(res);
    onStage?.('idle');
  }, (err) => {
    onError?.(err);
  });
}

function applyBezierParams(params, { onSuccess, onError } = {}) {
  const request = {
    bezier_degree: params.bezierDegree,
    guess_degree: params.guessDegree,
    n_split: params.nSplit,
    constr_flags: params.constrFlags,
    number_sample_Pts: params.numberSamplePts ?? 200
  };

  callService('setBezierParams', request, (result) => {
    onSuccess?.(result);
  }, (err) => {
    onError?.(err);
  });
}

function applyBounds(bounds, gains, { onSuccess, onError } = {}) {
  const request = {
    vel_min: bounds.vel_min,
    vel_max: bounds.vel_max,
    acc_min: bounds.acc_min,
    acc_max: bounds.acc_max,
    ang_vel_min: bounds.ang_vel_min,
    ang_vel_max: bounds.ang_vel_max,
    ang_acc_min: bounds.ang_acc_min,
    ang_acc_max: bounds.ang_acc_max,
    obs_min: bounds.obs_min,
    obs_max: bounds.obs_max,
    radius: bounds.radius,
    alpha: gains.alpha,
    beta: gains.beta,
    gamma: gains.gamma
  };

  callService('setBounds', request, (res) => {
    onSuccess?.(res);
  }, (err) => {
    onError?.(err);
  });
}

function applyChanges(params, callbacks = {}) {
  applyBezierParams(params.bezierParams, { onSuccess: callbacks.onBezierSuccess, onError: callbacks.onBezierError });
  applyBounds(params.boundParams, params.gains, { onSuccess: callbacks.onBoundsSuccess, onError: callbacks.onBoundsError });
}

function loadPlannerConfig({ onLoaded, onError } = {}) {
  callService('getPlannerConfig', {}, (result) => {
    onLoaded?.(result);
  }, (err) => {
    onError?.(err);
  });
}

export {
  isExecutingMission,
  executionSamples,
  deployMissionWithProgress,
  subscribeExecutionProgress,
  startCPFForSelectedVehicles,
  stopCPFForSelectedVehicles,
  startPFForSelectedVehicles,
  stopPFForSelectedVehicles,
  sendGoalToVehicle,
  sendStateToVehicle,
  sendObstacles,
  runOptimization,
  cancelOptimization,
  applyBezierParams,
  applyBounds,
  applyChanges,
  loadPlannerConfig
};

// export async function setGoal(vehicleName, north, east, theta, velocity) {
//   const request = {
//     vehicle_name: vehicleName,
//     n: north,        // Changed from 'north' to 'n'
//     e: east,         // Changed from 'east' to 'e'
//     theta: theta,
//     v: velocity
//   };
  
//   return rosModule.callServiceAsync('setGoal', request);
// }

// export async function setBezierParams(degree, guessDeree, nSplit, constrFlags, numSamplePoints) {
//   const request = {
//     bezier_degree: degree,
//     guess_degree: guessDeree,
//     n_split: nSplit,           // Changed from 'nSplit'
//     constr_flags: constrFlags, // Changed from 'constraintFlags'
//     number_sample_pts: numSamplePoints
//   };
  
//   return rosModule.callServiceAsync('setBezierParams', request);
// }

// export async function setBounds(bounds) {
//   const request = {
//     vel_min: bounds.vel_min,
//     vel_max: bounds.vel_max,
//     acc_min: bounds.acc_min,
//     acc_max: bounds.acc_max,
//     ang_vel_min: bounds.ang_vel_min,
//     ang_vel_max: bounds.ang_vel_max,
//     ang_acc_min: bounds.ang_acc_min,
//     ang_acc_max: bounds.ang_acc_max,
//     obs_min: bounds.obs_min,
//     obs_max: bounds.obs_max,
//     radius: bounds.radius,
//     alpha: bounds.alpha,
//     beta: bounds.beta,
//     gamma: bounds.gamma
//   };
  
//   return rosModule.callServiceAsync('setBounds', request);
// }

// export async function runOptimization(vehicleNames) {
//   const request = {
//     vehicle_names: vehicleNames || []
//   };
  
//   return rosModule.callServiceAsync('runOptimization', request);
// }

// export async function setObstacles(circularObstacles, lineObstacles) {
//   const request = {
//     circ_obs: circularObstacles || [],
//     line_obs: lineObstacles || []
//   };
  
//   return rosModule.callServiceAsync('setObstacles', request);
// }

// export async function getPlannerConfig() {
//   return rosModule.callServiceAsync('getPlannerConfig', {});
// }
