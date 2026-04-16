# **🚗 Rear Light Bar Simulator v0.1-alpha**

This is the initial pre-release of the **Rear Light Bar Simulator**, a high-fidelity web-based tool for visualizing modern automotive lighting behaviors. This version focuses on core signaling logic, manufacturer-specific animations, and responsive UI feedback.

## **✨ Highlights & Features**

* **Full Logic Rewrite:** Transitioned to an async/await based animation engine for precise timing and reliable state management.  
* **6 Signal Modes:**  
  * **Audi:** Dynamic sequential "sweeping" effect.  
  * **BMW:** Luxury-focused smooth fading transitions.  
  * **Mazda:** The signature "Heartbeat" pulsing/dimming amber LED effect.  
  * **Normal:** Traditional instant-response amber LED signaling.  
  * **USDM:** North American standard using the main red brake/running segments.  
  * **Halogen:** Advanced simulation of incandescent thermal physics (filament warm-up and cool-down).  
* **Brake Light Integration:** Hold S for bright red override on all segments with maximum intensity.
* **Reverse Light Mode:** Hold Q for 250ms to toggle white center segments simulating backup lights.
* **Adjustable Segment Count:** Dynamic segment density control (20-120 segments) with real-time regeneration.
* **Touch/Mobile Controls:** Responsive touch-optimized UI buttons for full functionality on mobile devices.
* **Welcome/Goodbye Sequences:** Interactive lock/unlock animations that sweep across the bar.  
* **Integrated Dashboard:** Real-time dashboard indicators that mirror the light bar's state.  
* **Self-Test Suite:** Built-in automated diagnostic tool to verify animation stability and state cleanup.

## **⌨️ Controls**

| Key | Action |
| :---- | :---- |
| **F** | **Lock / Unlock** (Toggle system power and welcome/goodbye sequence) |
| **Z** | **Left Signal** (Toggle) |
| **C** | **Right Signal** (Toggle) |
| **X** | **Hazard Lights** (Toggle) |
| **M** | **Change Mode** (Cycles through signaling styles) |
| **H** | **Toggle UI** (Clean mode \- hides the control panel) |
| **S** | **Brake Lights** (Hold to activate bright red override) |
| **Q** | **Reverse Lights** (Hold 250ms to toggle white center segments) |
| **T (Hold)** | **Run Self-Tests** (Automated logic verification) |

## **🛠 Technical Details**
* **Architecture:** 100% Vanilla JavaScript (no frameworks).  
* **Styling:** CSS Variables (Custom Properties) for dynamic "glow" effects and easy skinning.  
* **Performance:** Optimized for 60FPS using a blend of CSS transitions and asynchronous timing.  
* **Assets:** Inline SVGs and Inter typeface for a modern, premium aesthetic.

## **🚀 Installation & Usage**

### **Option 1: Standalone HTML (Quickest)**

Use this if you only want to run the simulator on your current device.

1. Download `TaillightSim.html` (or clone this repository).  
2. Open `TaillightSim.html` in any modern web browser.  
3. Use keyboard controls or touch buttons to interact with the light bar.

### **Option 2: Local HTTP Server (LAN / Other Devices)**

Use this if you want to access the simulator from phones/tablets/computers on the same network.

1. Open a terminal in the project folder.  
2. Start the server:

```powershell
python taillight_server.py --host 0.0.0.0 --port 8088
```

If you are using the workspace virtual environment:

```powershell
.\.venv\Scripts\python.exe taillight_server.py --host 0.0.0.0 --port 8088
```

3. On this machine, open `http://127.0.0.1:8088`.  
4. On other devices on the same network, open `http://<your-lan-ip>:8088`.  
5. If another device cannot connect, check firewall rules and make sure all devices are on the same local network.

Press `Ctrl+C` in the terminal to stop the server.

## **🚀 Agent Inspector Setup (Optional)**

This workspace includes an HTTP server entrypoint for local debugging with AI Toolkit Agent Inspector.

1. Install the workspace dependencies into the local environment:

```powershell
.\.venv\Scripts\python.exe -m pip install --pre -r requirements.txt
```

2. Launch the app from VS Code with the `Debug TaillightSim HTTP Server` configuration.

3. The simulator is served by `taillight_server.py` on all interfaces (`0.0.0.0:8088`).
   Open `http://<your-lan-ip>:8088` from other devices on the same network.

## **🗺️ Roadmap**

* \[x\] Brake Light Integration (Bright red override)  
* \[x\] Reverse Light Mode (White center segments)  
* \[x\] Adjustable Bar Segment Count (Configurable density)  
* \[x\] Touch/Mobile UI controls

*Developed for automotive enthusiasts and UI designers.*