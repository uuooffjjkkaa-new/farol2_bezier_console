/**
 * MotionPlanningConsole ROS helper module.
 *
 * This module wraps ROSLIB.Ros connection setup, topic creation,
 * and service creation so the app logic can stay cleaner.
 *
 * NOTE: Load the ROSLIB script before importing this module,
 * for example in index.html:
 *   <script src="https://cdn.jsdelivr.net/npm/roslib/build/roslib.min.js"></script>
 *   <script type="module" src="js/main.js"></script>
 */

const DEFAULT_ROS_URLS = [
  'ws://localhost:9090',
  // 'ws://192.168.1.32:9090',
  // 'ws://192.168.1.33:9090'
];

const rosConnections = [];
const rosByUrl = new Map();
const trajectoryTopics = {};
const missionTopics = {};
const missionTopicsAddons = {};
const missionStrings = {};
const serviceClients = {};

const serviceConfigs = {
  runOptimization: {
    name: '/farol2_motion_planning/run_optimization',
    serviceType: 'farol2_motion_planning/srv/RunOptimization'
  },
  cancelOptimization: {
    name: '/farol2_motion_planning/cancel_optimization',
    serviceType: 'std_srvs/srv/Trigger'
  }
};

const vehicleServiceConfigs = {
  setGoal: {
    suffix: 'set_goal',
    serviceType: 'farol2_motion_planning/srv/SetState'
  },
  setBezierParams: {
    suffix: 'set_bezier_params',
    serviceType: 'farol2_motion_planning/srv/SetBezierParams'
  },
  setBounds: {
    suffix: 'set_bounds',
    serviceType: 'farol2_motion_planning/srv/SetBoundsAndGains'
  },
  setStates: {
    suffix: 'set_states',
    serviceType: 'farol2_motion_planning/srv/SetState'
  },
  setObstacles: {
    suffix: 'set_obstacles',
    serviceType: 'farol2_motion_planning/srv/SetObstacles'
  },
  getPlannerConfig: {
    suffix: 'get_planner_config',
    serviceType: 'farol2_motion_planning/srv/GetPlannerConfig'
  }
};

const vehicleServiceClients = new Map();

function createRosInstance(url) {
  if (!window.ROSLIB) {
    throw new Error('ROSLIB must be loaded before ros.js. Include roslib.min.js before this module.');
  }

  const ros = new window.ROSLIB.Ros({ url });

  ros.on('connection', () => {
    console.log(`ROS connected: ${url}`);
  });

  ros.on('error', (error) => {
    console.error(`ROS error on ${url}:`, error);
  });

  ros.on('close', () => {
    console.warn(`ROS connection closed: ${url}`);
  });

  return ros;
}

function initRosConnections(urls = DEFAULT_ROS_URLS) {
  rosConnections.length = 0;
  rosByUrl.clear();

  urls.forEach((url) => {
    const ros = createRosInstance(url);
    rosConnections.push(ros);
    rosByUrl.set(url, ros);
    missionTopicsAddons[url] = {};
  });

  initServices();
  return rosConnections;
}

function getRosConnection(url) {
  return rosByUrl.get(url);
}

function getRosConnections() {
  return [...rosConnections];
}

function createTopic({ ros, name, messageType }) {
  return new window.ROSLIB.Topic({ ros, name, messageType });
}

function createService({ ros, name, serviceType }) {
  return new window.ROSLIB.Service({ ros, name, serviceType });
}

function initServices(ros = getRosConnection(DEFAULT_ROS_URLS[0]) || rosConnections[0]) {
  if (!ros) return;

  Object.entries(serviceConfigs).forEach(([key, cfg]) => {
    serviceClients[key] = createService({ ros, name: cfg.name, serviceType: cfg.serviceType });
  });
}

function getServiceClient(key) {
  return serviceClients[key];
}

function callService(key, request, onSuccess, onError) {
  const service = getServiceClient(key);
  if (!service) {
    throw new Error(`Service client not found: ${key}`);
  }
  service.callService(new window.ROSLIB.ServiceRequest(request), onSuccess, onError);
}

function callServiceAsync(key, request) {
  return new Promise((resolve, reject) => {
    callService(key, request, resolve, reject);
  });
}

function getVehicleServiceClient(key, vehicleName) {
  const config = vehicleServiceConfigs[key];

  if (!config) {
    throw new Error(`Unknown vehicle service: ${key}`);
  }

  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(vehicleName || '')) {
    throw new Error(`Invalid vehicle name: ${vehicleName}`);
  }

  const ros = getRosConnection(DEFAULT_ROS_URLS[0]) || rosConnections[0];
  if (!ros) {
    throw new Error('ROS is not connected');
  }

  const cacheKey = `${ros.url}:${vehicleName}:${key}`;

  if (!vehicleServiceClients.has(cacheKey)) {
    vehicleServiceClients.set(
      cacheKey,
      createService({
        ros,
        name: `/distributed_planner/${vehicleName}/${config.suffix}`,
        serviceType: config.serviceType
      })
    );
  }

  return vehicleServiceClients.get(cacheKey);
}

function callVehicleService(key, vehicleName, request, onSuccess, onError) {
  const service = getVehicleServiceClient(key, vehicleName);
  service.callService(
    new window.ROSLIB.ServiceRequest(request),
    onSuccess,
    onError
  );
}

function callVehicleServiceAsync(key, vehicleName, request) {
  return new Promise((resolve, reject) => {
    callVehicleService(key, vehicleName, request, resolve, reject);
  });
}

function buildVehicleListFromTopics(ros) {
  return new Promise((resolve, reject) => {
    ros.getTopics((result) => {
      const topics = result.topics || [];
      // Updated pattern for ROS2 vehicles (e.g., /mred0/State, /mblack1/State)
      const vehicleList = topics
        .map((topicName) => {
          const match = topicName.match(/^\/(m(red|black|yellow|vector|agicelectric)\d+)\/State$/);
          return match ? match[1] : null;
        })
        .filter(Boolean);

      console.log(`Discovered vehicles on ${ros.url}:`, vehicleList);
      resolve(vehicleList);
    }, reject);
  });
}

function buildVehicleNamesFromRawTopics(topics) {
  return topics
    .map((topicName) => {
      const match = topicName.match(/^\/(m(red|black|yellow|vector|agicelectric)\d+)\/State$/);
      return match ? match[1] : null;
    })
    .filter(Boolean);
}

function ensureMissionAddonTopic(ros, vehicleName) {
  if (!ros || !vehicleName) return null;
  const rosUrl = ros.url;
  if (!missionTopicsAddons[rosUrl]) missionTopicsAddons[rosUrl] = {};

  if (!missionTopicsAddons[rosUrl][vehicleName]) {
    missionTopicsAddons[rosUrl][vehicleName] = createTopic({
      ros,
      name: `/${vehicleName}/addons/Mission_String`,
      messageType: 'std_msgs/String'
    });
  }

  return missionTopicsAddons[rosUrl][vehicleName];
}

function ensureMissionTopic(vehicleName, ros) {
  if (!ros || !vehicleName) return null;
  if (!missionTopics[vehicleName]) {
    missionTopics[vehicleName] = createTopic({
      ros,
      name: `/${vehicleName}/planning_console/Mission_String`,
      messageType: 'std_msgs/String'
    });
  }
  return missionTopics[vehicleName];
}

function subscribeToMissionLog(callback) {
  const ros = getRosConnection(DEFAULT_ROS_URLS[0]) || rosConnections[0];
  if (!ros) return null;

  const logTopic = createTopic({ ros, name: '/farol2_motion_planning/mission_log', messageType: 'std_msgs/msg/String' });
  logTopic.subscribe((message) => {
    if (typeof callback === 'function') callback(message.data);
  });

  return logTopic;
}

function subscribePlanningAlive(callback, ros = getRosConnection(DEFAULT_ROS_URLS[0]) || rosConnections[0]) {
  if (!ros) return null;

  const aliveTopic = createTopic({ ros, name: '/farol2_motion_planning/node_alive', messageType: 'std_msgs/msg/Bool' });
  aliveTopic.subscribe((message) => {
    if (typeof callback === 'function') callback(message.data);
  });

  return aliveTopic;
}

function subscribeVehicleState(ros, vehicleName, onMessage) {
  if (!ros || !vehicleName) return null;
  const topic = createTopic({ ros, name: `/${vehicleName}/State`, messageType: 'farol2_interfaces/msg/StateConsole' });
  topic.subscribe(onMessage);
  return topic;
}

function subscribePlannedTrajectory(onTrajectory) {
  const localRos = getRosConnection(DEFAULT_ROS_URLS[0]) || rosConnections[0];
  if (!localRos) return null;

  return function(vehicleName) {
    if (!vehicleName) return null;
    if (!trajectoryTopics[vehicleName]) {
      trajectoryTopics[vehicleName] = createTopic({
        ros: localRos,
        name: `/${vehicleName}/planned_path`,
        messageType: 'nav_msgs/msg/Path'
      });
      trajectoryTopics[vehicleName].subscribe(onTrajectory);
    }
    return trajectoryTopics[vehicleName];
  };
}

function subscribePlannerMissionOutput(vehicleName, callback, ros = getRosConnection(DEFAULT_ROS_URLS[0]) || rosConnections[0]) {
  if (!ros || !vehicleName) return null;

  const topic = createTopic({
    ros,
    name: `/${vehicleName}/planning_console/Mission_String`,
    messageType: 'std_msgs/msg/String'
  });

  topic.subscribe((msg) => {
    missionStrings[vehicleName] = msg.data;
    if (typeof callback === 'function') callback(vehicleName, msg.data);
  });

  return topic;
}

function subscribeMissionString(ros, vehicleName, callback) {
  if (!ros || !vehicleName) return null;

  const topic = createTopic({
    ros,
    name: `/${vehicleName}/addons/Mission_String`,
    messageType: 'std_msgs/String'
  });

  topic.subscribe((msg) => {
    missionStrings[vehicleName] = msg.data;
    if (typeof callback === 'function') callback(vehicleName, msg.data);
  });

  return topic;
}

async function vehicleApi(path = '', options = {}) {
  const response = await fetch(`/api/vehicles${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Vehicle API failed (${response.status})`);
  }
  return result;
}

function launchVehicle(name) {
  return vehicleApi('', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

function getLaunchedVehicles() {
  return vehicleApi();
}

function stopVehicle(name) {
  return vehicleApi(`/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

function publishDistributedStartStop(vehicleNames, start) {
  const ros = getRosConnection(DEFAULT_ROS_URLS[0]) || rosConnections[0];

  if (!ros || !ros.isConnected) {
    throw new Error('ROS is not connected; cannot send distributed command.');
  }

  const names = [...new Set(vehicleNames)]
    .filter((name) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name));

  if (names.length === 0) {
    throw new Error('No valid selected vehicle names.');
  }

  const topic = createTopic({
    ros,
    name: '/farol2_motion_planning/distributed_planner_node/start_stop_distributed',
    messageType: 'farol2_motion_planning/msg/DistributedCommand'
  });

  topic.publish(new window.ROSLIB.Message({
    vehicle_names: names,
    start: Boolean(start)
  }));

  return names;
}

const discoveryServiceClients = new Map();

function setVehicleDiscoveryMode(vehicleName, enabled) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(vehicleName || '')) {
    return Promise.reject(new Error(`Invalid vehicle name: ${vehicleName}`));
  }

  const ros = getRosConnection(DEFAULT_ROS_URLS[0]) || rosConnections[0];
  if (!ros) return Promise.reject(new Error('ROS is not connected'));

  const serviceName =
    `/farol2_motion_planning/distributed_planner_node/${vehicleName}/set_parameters`;

  let service = discoveryServiceClients.get(serviceName);
  if (!service) {
    service = createService({
      ros,
      name: serviceName,
      serviceType: 'rcl_interfaces/srv/SetParameters'
    });
    discoveryServiceClients.set(serviceName, service);
  }

  return new Promise((resolve, reject) => {
    service.callService(
      new window.ROSLIB.ServiceRequest({
        parameters: [{
          name: 'discovery_mode',
          value: { type: 1, bool_value: enabled }
        }]
      }),
      (response) => {
        const result = response.results?.[0];
        if (result && !result.successful) {
          reject(new Error(result.reason || `Could not set discovery_mode for ${vehicleName}`));
          return;
        }
        resolve(response);
      },
      reject
    );
  });
}

export {
  DEFAULT_ROS_URLS,
  rosConnections,
  rosByUrl,
  trajectoryTopics,
  missionTopics,
  missionTopicsAddons,
  missionStrings,
  serviceClients,
  initRosConnections,
  getRosConnection,
  getRosConnections,
  buildVehicleListFromTopics,
  buildVehicleNamesFromRawTopics,
  ensureMissionAddonTopic,
  ensureMissionTopic,
  subscribeToMissionLog,
  subscribePlanningAlive,
  subscribeVehicleState,
  subscribePlannedTrajectory,
  subscribePlannerMissionOutput,
  subscribeMissionString,
  callService,
  callServiceAsync,
  getServiceClient,
  callVehicleService,
  callVehicleServiceAsync,
  createRosInstance,
  createTopic,
  createService,
  launchVehicle,
  getLaunchedVehicles,
  stopVehicle,
  publishDistributedStartStop,
  setVehicleDiscoveryMode
};
