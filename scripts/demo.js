// One-command local demo (V6). Starts a Hardhat node, deploys ProvenanceTracker, registers the
// six demo participants, exports the ABI, seeds two demo batches (scripts/e2e-journey.js) and
// starts the web app. Ctrl+C stops everything.
//
//   npm run demo                 laptop only (http://localhost:5173)
//   npm run demo -- --lan        also reachable from a phone on the same Wi-Fi (QR scanning)
//   npm run demo -- --no-web     chain + data only (start the web app yourself)
//   npm run demo -- --no-seed    no demo batches, just roles
//
// The node's output (including the default test account keys to import into MetaMask) goes to
// demo-node.log in the repo root. See docs/demo-runbook.md.

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");
const NODE_LOG = path.join(ROOT, "demo-node.log");
const RPC_PORT = 8545;
const WEB_PORT = 5173;
const IS_WINDOWS = process.platform === "win32";

const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!["--lan", "--no-web", "--no-seed", "--help"].includes(arg)) {
    console.error(`Unknown option ${arg}. Options: --lan, --no-web, --no-seed`);
    process.exit(1);
  }
}
if (args.has("--help")) {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(0, 11).join("\n"));
  process.exit(0);
}
const LAN = args.has("--lan");

const children = [];

function log(message) {
  console.log(`\x1b[36m[demo]\x1b[0m ${message}`);
}

function lanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

/** Resolves true if something is already listening on the port. */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForRpc(timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${RPC_PORT}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`The Hardhat node did not start within ${timeoutMs / 1000}s. See ${NODE_LOG}.`);
}

/** Runs a command to completion with its output shown; throws if it fails. */
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: "inherit", shell: IS_WINDOWS, ...options });
  if (result.status !== 0) {
    throw new Error(`"${command} ${commandArgs.join(" ")}" failed (exit code ${result.status}).`);
  }
}

function hardhatRun(script, env) {
  run("npx", ["hardhat", "run", `scripts/${script}`, "--network", "localhost"], {
    env: { ...process.env, ...env },
  });
}

function stopAll(code = 0) {
  for (const child of children) {
    if (child.exitCode === null) {
      if (IS_WINDOWS) spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
      else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
    }
  }
  process.exit(code);
}

async function main() {
  for (const [port, what] of [
    [RPC_PORT, "a blockchain node"],
    ...(args.has("--no-web") ? [] : [[WEB_PORT, "the web app"]]),
  ]) {
    if (await portInUse(port)) {
      throw new Error(`Port ${port} is already in use (${what} may already be running). Stop it and try again.`);
    }
  }

  if (!args.has("--no-web") && !fs.existsSync(path.join(WEB, "node_modules"))) {
    log("Installing web app dependencies (first run only)...");
    run("npm", ["install"], { cwd: WEB });
  }

  log(`Starting the Hardhat node${LAN ? " on all interfaces (--lan)" : ""}; output in demo-node.log`);
  const nodeLog = fs.openSync(NODE_LOG, "w");
  const node = spawn("npx", ["hardhat", "node", ...(LAN ? ["--hostname", "0.0.0.0"] : [])], {
    cwd: ROOT,
    stdio: ["ignore", nodeLog, nodeLog],
    shell: IS_WINDOWS,
    detached: !IS_WINDOWS,
  });
  children.push(node);
  node.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`The Hardhat node exited (code ${code}). See ${NODE_LOG}.`);
      stopAll(1);
    }
  });
  await waitForRpc();

  const lan = LAN ? lanAddress() : null;
  const appBase = lan ? `http://${lan}:${WEB_PORT}` : `http://localhost:${WEB_PORT}`;

  log("Deploying ProvenanceTracker...");
  hardhatRun("deploy.js");
  log("Registering the six demo participants...");
  hardhatRun("seed-roles.js");
  log("Exporting the ABI to the web app and simulator...");
  hardhatRun("export-abi.js");
  if (!args.has("--no-seed")) {
    log("Seeding demo batches (happy path + excursion/recall)...");
    hardhatRun("e2e-journey.js", { VERIFY_BASE_URL: appBase });
  }

  console.log(`
\x1b[32mPharmaTrace local demo is ready.\x1b[0m

  Web app         ${args.has("--no-web") ? "(not started: npm run web)" : appBase}
  Blockchain RPC  http://${lan ?? "127.0.0.1"}:${RPC_PORT}  (chain ID 31337)
  Test accounts   private keys are in demo-node.log (public Hardhat test keys, no real funds)
                  #0 Admin  #1 Manufacturer  #2 Distributor  #3 Carrier
                  #4 Pharmacy  #5 Regulator  #6 Oracle
  Simulator       npm run sim -- --batch <id> --scenario normal|excursion
  Runbook         docs/demo-runbook.md
${lan ? "" : "\n  Phone scanning: restart with  npm run demo -- --lan\n"}
Press Ctrl+C to stop.
`);

  if (args.has("--no-web")) {
    // Keep the node running until Ctrl+C.
    return;
  }
  const web = spawn("npm", ["run", "dev"], {
    cwd: WEB,
    stdio: "inherit",
    shell: IS_WINDOWS,
    detached: !IS_WINDOWS,
  });
  children.push(web);
  web.on("exit", (code) => stopAll(code ?? 0));
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

main().catch((error) => {
  console.error(`\n\x1b[31m[demo] ${error.message}\x1b[0m`);
  stopAll(1);
});
