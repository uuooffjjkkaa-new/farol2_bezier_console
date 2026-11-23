# Motion Planning Console

A web-based interactive console for motion planning and mission control with real-time visualization and ROS2 integration via rosbridge. This application provides a graphical interface for planning and executing autonomous vehicle missions using the farol2 motion planning framework.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Setup & Launch Sequence](#setup--launch-sequence)
- [Accessing the Console](#accessing-the-console)
- [Features](#features)
- [File Structure](#file-structure)

## Overview

The Motion Planning Console is a browser-based interface that connects to your ROS2 motion planning system via rosbridge WebSocket. It allows you to:

- Visualize the environment and planned trajectories
- Interactively create and modify mission waypoints
- Monitor real-time vehicle state and sensor data
- Execute motion plans with safety constraints
- Log and analyze planning results (TODO: improve this)

## Architecture

The console follows a modular architecture with clear separation of concerns:

```
┌─────────────────────────────────────────┐
│         Browser / Web UI                 │
│    (HTML, CSS, JavaScript)              │
└──────────────┬──────────────────────────┘
               │ WebSocket
               │ (rosbridge)
┌──────────────▼──────────────────────────┐
│      ROS2 System (via rosbridge)         │
├──────────────────────────────────────────┤
│  - farol2_motion_planning node           │
│  - Interactive planner                   │
│  - Vehicle state publishers              │
│  - Mission execution                     │
└──────────────────────────────────────────┘
```

### JavaScript Modules

- **`ros.js`** — ROS2 connection management via rosbridge, topic subscriptions, and service calls
- **`canvas.js`** — Canvas rendering, map display, trajectory visualization, and user interactions
- **`ui.js`** — Tab navigation, controls panel, logging interface, and UI state management
- **`planning.js`** — Mission planning logic, optimization, waypoint management, and plan execution
- **`utils.js`** — Utility functions for coordinate conversions, data formatting, and calculations
- **`main.js`** — Application initialization and module orchestration

## Prerequisites

### System Requirements

- **ROS2**: Jazzy or compatible distribution with farol2 workspace
- **Python 3**: 3.8 or later (for HTTP server)
- **Web Browser**: Modern browser with WebSocket support (Chrome, Firefox, Edge, Safari)
- **rosbridge_server**: ROS2 package for WebSocket-to-ROS bridge
- **farol2**: Motion planning framework (must be built and sourced)
- **farol2_motion_planning**: Motion planning package with interactive planner

### Verify Prerequisites

```bash
# Check ROS2 is installed and sourced
echo $ROS_DISTRO

# Verify farol2 is built
ls $HOME/farol2_ws/src/farol2

# Check if rosbridge is installed
ros2 pkg list | grep rosbridge
```

If rosbridge is not installed:

```bash
sudo apt install ros-<distro>-rosbridge-server
```

## Installation

1. **Ensure your ROS2 workspace is set up:**

```bash
# Source ROS2 setup (if not in your bashrc)
source /opt/ros/<distro>/setup.bash

# Build farol2 workspace (if not already done)
cd ~/farol2_ws
colcon build --symlink-install
source install/setup.bash
```

2. **Verify the console is in your farol2 repository:**

```bash
# The console should be at one of these locations:
ls ~/farol2_ws/src/farol2_motion_planning/src/farol2_bezier_console
# or
ls ~/farol2_ws/src/farol2_bezier_console
```

3. **No additional dependencies** — The console is pure HTML/CSS/JavaScript with no build step required.

## Setup & Launch Sequence

**Important:** The launch order is critical. Follow these steps exactly:

### Step 1: Terminal 1 — Source and Launch farol2

```bash
# Navigate to your workspace
colcon_cd

# Source the workspace
S

# Launch farol2 (adjust the command to match your setup)
ros2 launch farol2_bringup start_vehicle_sim.launch.py
```

Wait for the message indicating farol2 is ready (~5 seconds).

### Step 2: Terminal 2 — Launch rosbridge Server

```bash
# Source the workspace
source ~/farol2_ws/install/setup.bash

# Launch rosbridge WebSocket server
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

You should see output like:
```
[rosbridge_websocket-1] Rosbridge WebSocket server started at ws://0.0.0.0:9090
```

### Step 3: Terminal 3 — Start HTTP Server

Navigate to the root of your farol2 repository or wherever the console parent directory is:

```bash
# Navigate to the directory containing 'src/'
cd ~/farol2_ws

# Start Python HTTP server
python3 -m http.server 8000
```

You should see:
```
Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...
```

### Step 4: Terminal 4 — Launch Motion Planning Node

```bash
# Source the workspace
source ~/farol2_ws/install/setup.bash

# Launch the interactive planner
ros2 launch farol2_motion_planning interactive_planner.launch.py
```

Wait for initialization (~3 seconds).

## Accessing the Console

### In Your Browser

1. Open a web browser (Chrome recommended)
2. Navigate to the console URL:

```
http://127.0.0.1:8000/src/farol2_bezier_console/
```

**Breaking down the URL:**
- `http://127.0.0.1:8000/` — Python HTTP server serving your farol2 workspace root
- `src/farol2_bezier_console/` — Path to the console application relative to workspace root

### Verify Connection

Once the page loads:

1. Check the **Connection Status** indicator (usually in the top-right or status bar)
   - Should show "Connected" in green if rosbridge connection is successful
2. The **Map View** should be visible with the environment background
3. **ROS Topics** should begin streaming (you'll see data in logs/UI if available)

If the page doesn't load or shows "Disconnected":
- See [Troubleshooting](#troubleshooting) section

## Features

### Interactive Map View
- Pan and zoom on the canvas
- View environment assets (maps, obstacles)
- Visualize planned trajectories in real-time
- Draw waypoints and mission paths

### Mission Planning
- Define waypoint sequences (BEZIER commands)
- Set constraints
- Optimize trajectories using CasADi solver

### Real-Time Monitoring
- Live vehicle state (position, heading)
- Plan execution progress
- System logs and diagnostics

### Control Interface
- Start/stop mission execution
- Emergency stop functionality
- Parameter adjustment during planning
- Configuration persistence

## File Structure

```
MotionPlanningConsole/
├── index.html                 # Main application page
├── styles.css                 # All styling (consolidated)
├── js/                        # JavaScript modules
│   ├── ros.js                # ROS2 connection, topics, services
│   ├── canvas.js             # Map rendering and interactions
│   ├── ui.js                 # UI controls, tabs, logging
│   ├── planning.js           # Planning logic and optimization
│   ├── utils.js              # Utility functions
│   └── main.js               # App initialization
├── assets/                    # Image and static resources
│   ├── map_expo_color.png    # Environment map (color)
│   └── island_circ.png       # Additional map layer
├── README.md                  # This file
└── (other configuration files)
```
