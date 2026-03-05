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
| **T (Hold)** | **Run Self-Tests** (Automated logic verification) |

## **🛠 Technical Details**

* **Architecture:** 100% Vanilla JavaScript (no frameworks).  
* **Styling:** CSS Variables (Custom Properties) for dynamic "glow" effects and easy skinning.  
* **Performance:** Optimized for 60FPS using a blend of CSS transitions and asynchronous timing.  
* **Assets:** Inline SVGs and Inter typeface for a modern, premium aesthetic.

## **🚀 Installation & Usage**

1. Download Rewritten\_TaillightSim.html.  
2. Open the file in any modern web browser.  
3. Use the keyboard controls to interact with the light bar.

## **🗺️ Roadmap (Coming Soon)**

* \[ \] Brake Light Integration (Bright red override)  
* \[ \] Reverse Light Mode (White center segments)  
* \[ \] Adjustable Bar Segment Count (Configurable density)  
* \[ \] Touch/Mobile UI controls

*Developed for automotive enthusiasts and UI designers.*