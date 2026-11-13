# Scalar TDS Lab

Scalar is a responsive dashboard for viewing total dissolved solids (TDS) readings from an Arduino. A browser connected to the Arduino reads its USB serial stream. The app shows the current value, a live graph, and the latest five readings. Other people on the same local network can follow the live experiment from their own devices.

The app uses React, TypeScript, and Vite. It has no login and no persistent server-side database.

## What is implemented

- **Arduino serial input:** Web Serial opens a user-selected port at 9600 baud and parses Scalar TDS rows.
- **TDS dashboard:** The main view shows TDS, optional temperature, elapsed session time, and a graph of the current run.
- **TDS unit selector:** Choose ppm or mg/L. For dilute water samples, the app displays the same numeric value under either label because these units are approximately equivalent in that range. It does not perform a concentration conversion. [USGS unit guidance](https://pubs.usgs.gov/wri/1985/4220/report.pdf).
- **Five-row live queue:** The local table shows the newest five samples, ordered oldest to newest. A new sample appears at the bottom and rolls the oldest row off the top. The active session still retains the full run for its graph and export.
- **LAN live sharing:** Every browser tab has a temporary source ID. Readings are relayed to the host and sent to connected viewers using Server-Sent Events. Multiple sources appear as separate experiments, each with its own graph and expandable full reading table.
- **Device-local logging:** Saving a session writes it to the collecting browser's local storage. The other devices' network view is read-only; they do not receive a local saved copy automatically.
- **CSV and TXT export:** Export the current or saved session, or export all saved sessions. CSV uses commas; TXT uses tabs. Exports include local receive time, Arduino uptime, TDS, and optional temperature.
- **Help section:** The in-app guide explains network access, Arduino connection, graphs, save/export behavior, and the serial line format.
- **Responsive layout:** The dashboard adapts to laptop, tablet, and phone screens. Arduino connection itself depends on device and browser support.

## How the live data moves

```mermaid
flowchart LR
    A[Arduino TDS firmware] -->|USB serial, 9600 baud| B[Collecting browser]
    B --> C[Parse sample and timestamp]
    C --> D[Live table and graph]
    C -->|HTTP POST /api/readings| E[LAN relay in host memory]
    E -->|Server-Sent Events /api/live| F[Other browser viewers]
    E --> G[Per-device experiment history]
    B -->|Save session| H[This browser's local storage]
    F -. read-only view .-> G
```

## Start Scalar in the lab (Windows)

The lab version is operated with the included Windows installer and desktop shortcuts. **Faculty do not need to use a terminal or enter setup commands.**

### First-time setup

1. Copy or extract the Scalar project folder onto the Windows computer that will host the lab session. Keep the folder in a permanent location; the desktop shortcuts created during setup point to it.
2. Double-click [`Install Scalar.bat`](<Install Scalar.bat>) and wait for setup to finish. The installer checks for Node.js 20 or later, installs Node.js LTS if needed, downloads the app packages, prepares the production dashboard, and creates **Scalar Lab** and **Stop Scalar Lab** desktop shortcuts. Internet access is required during setup.
3. If Windows Package Manager is unavailable, the installer opens the official Node.js download page. Install the Node.js LTS version, then run **Install Scalar.bat** again.

### Each lab session

1. On the host computer, connect the Arduino to USB and double-click the **Scalar Lab** desktop shortcut. The launcher starts the local server and opens the dashboard in the default browser. If the app has not been prepared yet, the launcher starts the installer automatically.
2. In the dashboard, select **Connect Arduino** and choose the Arduino's serial port. Use Chrome or Edge on the host computer for the serial connection.
3. The launcher displays the host computer's local address and the address(es) other devices can use. On other devices connected to the same lab Wi-Fi, open one of the displayed network addresses to view the live experiment. Network viewers can watch readings but cannot connect to the Arduino or save the host's session.
4. Keep the host computer on while the lab is running. At the end, save or export any readings you need, then double-click **Stop Scalar Lab** to stop the server.

If Windows Firewall asks whether Node.js can accept connections, allow it on the lab's **Private network** only. The host and viewers must be on a network that permits devices to communicate with one another. Scalar does not require an account; anyone who can reach the app on that network can view the live feed.

### Troubleshooting

- **The browser shows `Forbidden`:** double-click **Stop Scalar Lab**, then start **Scalar Lab** again.
- **The launcher says the server could not start:** check the `logs` folder inside the Scalar project folder. `scalar-server-error.log` contains startup errors; `scalar-server.log` contains server startup information.
- **The launcher reports that ports are already in use:** close another Scalar instance or ask the lab's IT support for help. The launcher checks ports 4174 through 4194.
- **Other devices cannot connect:** use an address displayed by the launcher, confirm both devices are on the same lab Wi-Fi, keep the host computer running, and allow Node.js on the Windows **Private network** if prompted.
- **The Arduino cannot be selected:** connect it to the host computer and use Chrome or Edge. Network viewers can see the live feed, but only the host browser can access the USB serial device.

## Arduino serial format

Use **9600 baud** and send one UTF-8 line per sample, terminated by a newline:

```text
SCALAR,1,1240,245.50,24.8
```

The fields are:

| Field | Meaning | Example |
| --- | --- | --- |
| `SCALAR` | Protocol marker | `SCALAR` |
| `1` | Protocol version | `1` |
| `1240` | Arduino uptime from `millis()`, in milliseconds | `1240` |
| `245.50` | Arduino TDS reading before site calibration, in ppm | `245.50` |
| `24.8` | Optional temperature, in degrees Celsius | `24.8` |

The browser currently applies `TDS_ppm = max(0, 1.863 × PPM_Arduino − 27.3)` to the incoming PPM estimate, then records its own local receive time as well as Arduino uptime. The firmware must convert the probe's electrical signal into an unadjusted PPM estimate first; the browser applies the project's current linear correction. Validate this correction against the lab's reference solutions before treating readings as experimental results. Temperature is not required; send an empty final field, for example `SCALAR,1,1240,245.50,`.

### Serial test sketch

[`arduino/scalar_serial_test.ino`](arduino/scalar_serial_test.ino) emits smooth synthetic values once per second using the same protocol. Use it to check serial transport, the rolling queue, chart, network viewers, local save, and exports before sensor calibration. It **does not measure TDS**. Real firmware must convert the probe's electrical signal into an unadjusted TDS estimate in ppm; the browser then applies the linear correction described above.

## Data and privacy model

- The host relay holds live experiments and their readings in memory only. Restarting the relay clears that shared history.
- Each browser tab has a separate temporary source identity, so readings from separate devices form separate experiments.
- A session saved from the collecting browser is stored only in that browser's local storage. Clearing that browser's site data removes it.
- Network viewers can see the complete in-memory live experiment history but cannot save it into the source browser's local log. Use an exported file to transfer a saved session.
- There is no login or network access control. Anyone who can reach the app on the LAN can view the live feed. Use it on a trusted lab network.

### Public hosting note

If the app is deployed publicly, automated scans and requests are normal internet background traffic; that does not mean the project has been personally targeted. Vercel provides platform-level DDoS mitigation and configurable WAF/rate limiting, but those do not make an unauthenticated app private. The current relay accepts readings from any client that can reach it and has no login, so do not publish real lab readings on a public deployment until access control and request limits are in place. [Vercel DDoS mitigation](https://vercel.com/docs/vercel-firewall/ddos-mitigation) · [Deployment Protection](https://vercel.com/docs/deployment-protection) · [WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

## Project structure

```text
src/
  App.tsx                       Dashboard and experiment workflows
  components/Sparkline.tsx      TDS graph
  domain/types.ts               Reading, session, and shared experiment types
  services/measurements.ts      Serial parser and TDS unit display
  services/serialDevice.ts      Web Serial connection
  services/sessionRepository.ts Device-local session persistence
  services/sharedFeed.ts        LAN event stream and reading publisher
server/
  liveFeed.mjs                  In-memory HTTP/SSE relay
  index.mjs                     Production static/API server
arduino/
  scalar_serial_test.ino        Synthetic serial protocol test sketch
Install Scalar.bat              One-time Windows setup
Launch Scalar.bat               Start server and open dashboard
Stop Scalar.bat                 Stop the background server
```

The project documentation is available as a PDF at [`docs/documentation_scalar.pdf`](docs/documentation_scalar.pdf). Open that file to read about the implemented features, setup, data flow, Arduino serial format, and current limitations.

