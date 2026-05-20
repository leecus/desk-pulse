const { execSync } = require("child_process");
const path = require("path");

const command = process.argv[2];
if (!["start", "status", "stop"].includes(command)) {
  console.error("Usage: node scripts/run.js <start|status|stop>");
  process.exit(1);
}

const scriptDir = __dirname;
const isWin = process.platform === "win32";
const ext = isWin ? "ps1" : "sh";
const shell = isWin ? "powershell.exe" : "bash";
const args = isWin ? ["-ExecutionPolicy", "Bypass", "-File"] : [];
const script = path.join(scriptDir, `${command}_desk_pulse.${ext}`);

try {
  execSync(
    isWin
      ? `& "${script}"`
      : `bash "${script}"`,
    { shell, stdio: "inherit" }
  );
} catch (err) {
  process.exit(err.status || 1);
}
