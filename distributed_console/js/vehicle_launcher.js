import {
  launchVehicle,
  getLaunchedVehicles,
  stopVehicle
} from './ros.js';

const form = document.getElementById('vehicle-launch-form');
const nameInput = document.getElementById('vehicle-name');
const statusElement = document.getElementById('vehicle-launch-status');
const listElement = document.getElementById('launched-vehicles');

function setStatus(message) {
  statusElement.textContent = message;
}

function renderVehicles(vehicles) {
  listElement.replaceChildren();

  for (const vehicle of vehicles) {
    const item = document.createElement('li');
    item.append(`${vehicle.name}: ${vehicle.status}`);

    if (vehicle.status === 'running') {
      const stopButton = document.createElement('button');
      stopButton.type = 'button';
      stopButton.textContent = 'Stop';
      stopButton.addEventListener('click', async () => {
        try {
          await stopVehicle(vehicle.name);
          await refreshVehicles();
        } catch (error) {
          setStatus(error.message);
        }
      });
      item.append(' ', stopButton);
    }

    listElement.append(item);
  }
}

async function refreshVehicles() {
  const result = await getLaunchedVehicles();
  renderVehicles(result.vehicles);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();

  try {
    await launchVehicle(name);

    window.dispatchEvent(new CustomEvent('console:add-vehicle', {
      detail: { name }
    }));

    setStatus(`Launch requested for ${name}.`);
    await refreshVehicles();
  } catch (error) {
    setStatus(error.message);
  }
});

refreshVehicles().catch((error) => setStatus(error.message));
//setInterval(() => refreshVehicles().catch(() => {}), 2000);