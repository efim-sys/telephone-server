# telephone-server

UDP call server and status dashboard for the DIY telephone project.

## Requirements

- Linux
- Node.js >= 18 and npm

## Install & run

```bash
# 1. Install Node.js (Debian/Ubuntu example)
sudo apt update && sudo apt install -y nodejs npm

# 2. Get the code and install dependencies
git clone <repository-url>
cd telephone-server
npm install

# 3. (Optional) add audio files for test/incoming calls
cp /path/to/your/songs/* songs/

# 4. Start the server
npm start
```

## Ports

| Service   | Port |
|-----------|------|
| UDP (phones) | 4911 |
| WebSocket (dashboard) | 4912 |
| HTTP (dashboard page) | 4913 |

Open `http://localhost:4913` in a browser and enter the dashboard password
(see `DASHBOARD_PASSWORD` in `src/config.js`).

Configuration (ports, passwords, call numbers) lives in `src/config.js`.
