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

## Run the app

### Windows: install once, then use the desktop icon

For lab users, no terminal commands are needed for normal use:

1. Double-click [`Install Scalar.bat`](<Install Scalar.bat>) once. It checks for Node.js 20 or later, installs Node.js LTS with Windows Package Manager if needed, installs the app packages, builds Scalar, and creates **Scalar Lab** and **Stop Scalar Lab** desktop icons. The first setup needs internet access. If Windows Package Manager is unavailable, the installer opens the official Node.js download page and explains what to do next.
2. Double-click **Scalar Lab** whenever you want to use the dashboard. It starts the local server in the background, opens the site in your default browser, and displays the host computer's LAN addresses for the other lab devices.
3. Keep the host computer running while other devices view the live feed. When finished, double-click **Stop Scalar Lab**.

If Windows Firewall asks whether Node.js can accept connections, allow it on the **Private network** used by the lab. Do not allow public-network access for this lab setup.

### Development on a local network

Install dependencies once:

```sh
npm install
```

Start Vite and the built-in LAN relay:

```sh
npm run dev
```

Use the exact address Vite prints in the terminal on the host computer. It normally starts at `http://localhost:5173`; if that port is already occupied, Vite selects another port (for example, 5174). On other devices using the same Wi-Fi, use Vite's printed network address or replace `localhost` with the host computer's LAN IP. The host computer must remain on and the development server must remain running while viewers use the live feed. A firewall may need to allow connections to Vite's port.

### Production server

```sh
npm run build
npm start
```

The Node server serves the generated `dist` directory and the LAN API on port 4174 by default. Set the `PORT` environment variable to change the port. For access outside a trusted lab network, deploy behind HTTPS. Web Serial requires a secure context and is currently supported mainly in desktop Chromium browsers such as Chrome and Edge. The Arduino must be plugged into the device that selects **Connect Arduino**; other network devices can view the stream without a serial port.

The production server serves `index.html` for the root URL (`/`) and for client-side dashboard routes, while keeping requests inside the built `dist` directory. The Windows desktop launcher checks ports 4174 through 4194 and uses the first available one, so another app already using 4174 will not stop Scalar from launching. It confirms startup from the server's listening message, then opens the dashboard. Startup output and errors are kept in the `logs` folder.

### Troubleshooting the Windows launcher

- **The browser shows `Forbidden`:** stop Scalar Lab and launch it again so the server reloads the current files. The server should serve the dashboard at the root URL, such as `http://localhost:4174/` (the port may differ).
- **The launcher says the server could not start:** check `logs/scalar-server-error.log` and `logs/scalar-server.log` in the project folder. The first contains startup errors; the second confirms which port Node is listening on.
- **Other devices cannot connect:** use the LAN address shown by the launcher, keep the host computer on, and allow Node.js on the lab's Windows **Private** network if Windows Firewall prompts. Both devices must be on a network that permits device-to-device traffic.

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

