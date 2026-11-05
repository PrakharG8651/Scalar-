# Scalar — Conductivity Lab

A responsive, local-first web dashboard for the Scalar Arduino conductivity project. The app uses React, TypeScript, and Vite. Serial access, measurement parsing, and browser-local persistence live behind separate service boundaries so the UI can grow without tying itself to those implementation details.

## Run it

Install dependencies with `npm install`, then run `npm run dev`. Open the local URL printed by Vite. The development server listens on the network, so another device on the same Wi-Fi can open `http://<computer-ip>:5173` to view the interface. For a production build, run `npm run build` and host the generated `dist` directory on any static HTTPS host.

Web Serial requires a secure context and is currently available mainly in desktop Chromium browsers such as Chrome and Edge. A phone or tablet can open the site, but USB serial access depends on that device, browser, and available adapters. LAN URLs over plain HTTP allow interface review but generally do not grant serial access; use the HTTPS deployment or localhost on the computer connected to the Arduino.

There is no account, server, or user database. Saved sessions and the selected display unit are stored in this browser's local storage on this device. Clearing browser site data removes them. Download CSV files to back up or move measurements to another device.

## Arduino serial format

The browser opens the port at **9600 baud**. The synchronized protocol is one UTF-8 CSV line per sample, terminated by a newline:

```text
SCALAR,1,1240,1.420,24.8
```

The fields are protocol marker, version, Arduino uptime in milliseconds, conductivity in **mS/cm**, and optional temperature in **°C**. The browser also records its local receive time. Conductivity is displayed in either mS/cm or µS/cm; exports preserve mS/cm. The live table is a rolling queue of the latest five rows, while the full session remains available to save and export. CSV files use comma delimiters; TXT files use tab delimiters. Both include local receive time, Arduino elapsed time, conductivity, and optional temperature.

To exercise the full serial flow before connecting the probe, flash [`arduino/scalar_serial_test.ino`](arduino/scalar_serial_test.ino). It sends synthetic, changing readings at one sample per second. It verifies serial transport and the UI only; it does not measure conductivity. Once the probe circuit is finalized, replace the two simulated measurement functions with the calibrated sensor conversion and keep the documented line format. The web parser also accepts the prototype's bare numeric value and `time,conductivity,temperature` lines.

## Current scope

- Connect, disconnect, pause and stop a USB serial stream.
- Display latest conductivity, optional temperature, sample count and a live chart.
- Save completed measurements locally and export individual or all sessions as CSV.
- Responsive layout for phones, tablets, and laptops.
- Typed experiment and reading models shared across the application.

## Foundation roadmap

1. **Stabilize device input:** confirm the Arduino's exact line format, expose serial settings, and handle disconnects and malformed data clearly.
2. **Make experiments dependable:** add calibration workflows, steady-state detection, and resilient local storage for larger sessions while retaining CSV import/export.
3. **Add analysis:** implement trend views, experiment comparison, and report-ready exports using the shared measurement model.
4. **Extend sensors:** add pH, temperature, or turbidity through sensor-specific parsers that feed the same reading and chart interfaces.
5. **Deploy and review:** publish the static build over HTTPS and validate the supported browsers, screen sizes, and Arduino adapters in the lab.

No login, server, or user database is included. Session records are stored in this browser's local storage on this device. Clearing browser site data removes them; CSV is the current way to move data between devices.
