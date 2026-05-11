/**
 * MotionPlanningConsole utility module.
 *
 * Contains small reusable helpers for parsing values, converting names,
 * and saving/loading map state.
 */

const STORAGE_KEYS = {
  OBSTACLES: 'mp_obstacles',
  GOALS: 'mp_goals'
};

function vehicleNumber(name) {
  const match = name && name.match(/\d+$/);
  return match ? match[0] : '';
}

function vehicleColor(name) {
  if (!name || typeof name !== 'string') return 'blue';
  if (name.startsWith('mred')) return 'red';
  if (name.startsWith('mblack')) return 'black';
  if (name.startsWith('myellow')) return 'yellow';
  if (name.startsWith('mvector')) return 'green';
  return 'blue';
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function saveMapState({ obstacles, goals }) {
  try {
    localStorage.setItem(STORAGE_KEYS.OBSTACLES, JSON.stringify(obstacles || {}));
    localStorage.setItem(STORAGE_KEYS.GOALS, JSON.stringify(goals || {}));
  } catch (err) {
    console.warn('Unable to save map state:', err);
  }
}

function loadMapState() {
  const result = { obstacles: {}, goals: {} };
  try {
    const savedObstacles = localStorage.getItem(STORAGE_KEYS.OBSTACLES);
    const savedGoals = localStorage.getItem(STORAGE_KEYS.GOALS);
    if (savedObstacles) result.obstacles = JSON.parse(savedObstacles);
    if (savedGoals) result.goals = JSON.parse(savedGoals);
  } catch (err) {
    console.warn('Unable to load map state:', err);
  }
  return result;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function buildVehicleNamesFromRawTopics(topics) {
  if (!Array.isArray(topics)) return [];
  return topics
    .map((topicName) => {
      const match = topicName.match(/^\/(m(red|black|yellow|vector)[0-9]+)\/State$/);
      return match ? match[1] : null;
    })
    .filter(Boolean);
}

export {
  vehicleNumber,
  vehicleColor,
  parseNumber,
  saveMapState,
  loadMapState,
  clamp,
  buildVehicleNamesFromRawTopics
};
