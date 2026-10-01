import { spawn } from "node:child_process";

export class CommandError extends Error {
  constructor(command, args, code, stdout, stderr) {
    super(`${command} ${args.join(" ")} exited with code ${code}: ${stderr.trim() || stdout.trim()}`);
    this.name = "CommandError";
    this.command = command;
    this.args = args;
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function run(command, args, options = {}) {
  const {
    cwd,
    env = process.env,
    input,
    timeoutMs = 0,
    onStderr,
    allowFailure = false,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timer;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      onStderr?.(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      const exitCode = code ?? (signal ? 128 : 1);
      const result = { code: exitCode, signal, stdout, stderr };
      if (exitCode !== 0 && !allowFailure) {
        reject(new CommandError(command, args, exitCode, stdout, stderr));
      } else {
        resolve(result);
      }
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      timer.unref();
    }
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}
