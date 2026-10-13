import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const services = ['api', 'engine', 'ws', 'db-processor', 'market-maker'];
const packages = ['packages/contracts', ...services];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function run(directory, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(npm, args, { cwd: `${root}${directory}`, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() :
      reject(new Error(`${directory}: npm ${args.join(' ')} failed (${signal ?? code})`)));
  });
}

async function start() {
  // Compose owns the database worker. Do not start a second competing consumer.
  const children = ['engine', 'api', 'ws'].map(service => spawn(process.execPath,
    ['dist/index.js'], { cwd: `${root}${service}`, stdio: 'inherit' }));
  let stopping = false;
  const stop = code => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => {
      for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    }, 5000);
    timer.unref();
  };
  process.once('SIGINT', () => stop(0));
  process.once('SIGTERM', () => stop(0));
  for (const child of children) {
    child.once('error', error => { console.error(error.message); stop(1); });
    child.once('exit', () => stop(1));
  }
}

try {
  switch (process.argv[2]) {
    case 'bootstrap':
      for (const directory of packages) await run(directory, ['ci', '--no-audit', '--no-fund']);
      break;
    case 'build':
      for (const directory of packages) await run(directory, ['run', 'build']);
      break;
    case 'typecheck':
      // Service imports resolve the contracts declaration output.
      await run('packages/contracts', ['run', 'build']);
      for (const directory of packages) await run(directory, ['run', 'typecheck']);
      break;
    case 'start':
      await start();
      break;
    default:
      throw new Error('Use bootstrap, build, typecheck, or start.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
