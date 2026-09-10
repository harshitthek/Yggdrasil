import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { recordingService, getFfmpegPath } from '../src/services/recordingService.js';
import { createPlayerService } from '../src/services/playerService.js';
import { isOwner } from '../src/commands/utility/record.js';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

let passedCount = 0;
let failedCount = 0;

function pass(name, detail = '') {
  passedCount++;
  console.log(`  ${colors.green}✔ PASS${colors.reset} ${name}${detail ? ` (${detail})` : ''}`);
}

function fail(name, err) {
  failedCount++;
  console.error(`  ${colors.red}✖ FAIL${colors.reset} ${name}: ${err.message || err}`);
}

async function runSection(title, fn) {
  console.log(`\n${colors.bold}${colors.cyan}▶ ${title}${colors.reset}`);
  try {
    await fn();
  } catch (err) {
    fail(`Section failed (${title})`, err);
  }
}

async function main() {
  console.log(`${colors.bold}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}          WORLD TREE APPLICATION SMOKE TEST SUITE              ${colors.reset}`);
  console.log(`${colors.bold}═══════════════════════════════════════════════════════════════${colors.reset}`);

  // 1. ENVIRONMENT & CONFIGURATION
  await runSection('1. Environment & Configuration', async () => {
    const { getRuntimeEnv } = await import('../src/config/env.js');
    const env = getRuntimeEnv();
    assert.ok(env, 'Runtime env must be populated');
    assert.ok(env.nodeEnv, 'nodeEnv must exist');
    pass('Runtime environment loaded', `nodeEnv: "${env.nodeEnv}", engine: "${env.audioEngine}"`);

    const { BOT } = await import('../src/utils/constants.js');
    assert.ok(BOT.name, 'BOT.name must exist');
    assert.ok(BOT.prefix, 'BOT.prefix must exist');
    pass('Constants integrity verified', `BOT.name: "${BOT.name}", BOT.prefix: "${BOT.prefix}"`);
  });

  // 2. COMMAND REGISTRY & LOADERS
  await runSection('2. Command Registry & Schemas', async () => {
    const commandsDir = resolve('src/commands');
    let commandCount = 0;

    function walkDir(dir) {
      const files = readdirSync(dir);
      for (const file of files) {
        const fullPath = join(dir, file);
        if (statSync(fullPath).isDirectory()) {
          walkDir(fullPath);
        } else if (file.endsWith('.js')) {
          commandCount++;
        }
      }
    }

    walkDir(commandsDir);
    assert.ok(commandCount >= 40, `Expected at least 40 command files, found ${commandCount}`);
    pass('Command file scan', `Found ${commandCount} command definition files`);

    // Verify critical commands export valid structures
    const recordCmd = await import('../src/commands/utility/record.js');
    assert.ok(recordCmd.data, 'Record command must export data');
    assert.equal(recordCmd.data.name, 'record', 'Record command name must be "record"');
    assert.equal(typeof recordCmd.execute, 'function', 'Record command must export execute()');
    assert.equal(typeof recordCmd.executeMessage, 'function', 'Record command must export executeMessage()');
    assert.equal(recordCmd.botOwnerOnly, true, 'Record command must be restricted to bot owner');
    pass('Utility/record command schema and owner guards verified');

    const playCmd = await import('../src/commands/music/play.js');
    assert.ok(playCmd.data, 'Play command must export data');
    assert.equal(typeof playCmd.execute, 'function', 'Play command must export execute()');
    pass('Music/play command schema verified');

    const pingCmd = await import('../src/commands/utility/ping.js');
    assert.ok(pingCmd.data, 'Ping command must export data');
    pass('Utility/ping command schema verified');
  });

  // 3. EVENT HANDLERS
  await runSection('3. Event Loaders & Handlers', async () => {
    const eventsDir = resolve('src/events');
    const eventFiles = readdirSync(eventsDir).filter((f) => f.endsWith('.js'));
    assert.ok(eventFiles.length >= 4, `Expected at least 4 events, found ${eventFiles.length}`);

    for (const file of eventFiles) {
      const mod = await import(`../src/events/${file}`);
      assert.ok(mod.name, `Event in ${file} must export name`);
      assert.equal(typeof mod.execute, 'function', `Event in ${file} must export execute()`);
    }
    pass('All event handlers load with valid hooks', `${eventFiles.length} events verified`);
  });

  // 4. RECORDING & AUDIO ENCODING SUBSYSTEM
  await runSection('4. Recording & Audio Encoding Pipeline', async () => {
    // 4.1 FFmpeg availability
    const ffmpegPath = getFfmpegPath();
    assert.ok(ffmpegPath && existsSync(ffmpegPath), `FFmpeg binary not found at ${ffmpegPath}`);
    pass('FFmpeg binary verified', ffmpegPath);

    // 4.2 State tracking
    const dummyGuild = 'smoke-test-guild-' + Date.now();
    assert.equal(recordingService.isRecording(dummyGuild), false);
    assert.equal(recordingService.getRecording(dummyGuild), null);
    pass('RecordingService initial state check');

    // 4.3 Owner authorization logic
    assert.equal(isOwner('owner-1', { config: { botOwnerId: 'owner-1' } }, null), true);
    assert.equal(isOwner('intruder-2', { config: { botOwnerId: 'owner-1' } }, null), false);
    const teamOwnerClient = {
      application: {
        owner: {
          id: 'team-1',
          members: new Map([['team-member-1', { id: 'team-member-1' }]])
        }
      }
    };
    assert.equal(isOwner('team-member-1', { config: { botOwnerId: null } }, teamOwnerClient), true);
    assert.equal(isOwner('stranger-3', { config: { botOwnerId: null } }, teamOwnerClient), false);
    pass('Bot owner & team authentication logic verified');
  });

  // 5. MUSIC PLAYER SERVICE
  await runSection('5. Music Player Architecture', async () => {
    const playerService = createPlayerService();
    assert.ok(playerService, 'PlayerService must instantiate');
    assert.equal(typeof playerService.getPlayer, 'function');
    pass('PlayerService factory and method contracts verified');
  });

  // 6. LIVE HOST LIVENESS (ORACLE VM HEALTH CHECK)
  await runSection('6. Live Oracle Cloud Host Health', async () => {
    const sshKey = 'C:\\Users\\user\\Desktop\\dwsktop\\ygg2\\ssh-key-2026-08-22.key';
    const vmHost = 'opc@130.210.0.193';

    try {
      const pm2Output = execSync(
        `ssh -i "${sshKey}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${vmHost} "pm2 jlist"`,
        { encoding: 'utf8' }
      );
      const processes = JSON.parse(pm2Output);
      const botProc = processes.find((p) => p.name === 'world-tree');
      assert.ok(botProc, 'world-tree process must exist in PM2');
      assert.equal(botProc.pm2_env.status, 'online', 'world-tree process status must be "online"');
      pass('PM2 process online on VM', `PID: ${botProc.pid}, restarts: ${botProc.pm2_env.restart_time}`);

      const opsHealth = execSync(
        `ssh -i "${sshKey}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${vmHost} "cd /home/opc/apps/Yggdrasil-Bot && bash ops/health.sh"`,
        { encoding: 'utf8' }
      );
      assert.ok(opsHealth.includes('Overall Health: PASS'), 'ops/health.sh must pass');
      pass('Ops health checks passed on VM', 'ops/health.sh: PASS');
    } catch (err) {
      fail('Failed to query remote VM host', err);
    }
  });

  console.log(`\n${colors.bold}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(
    `Summary: ${colors.green}${passedCount} passed${colors.reset}, ${failedCount > 0 ? `${colors.red}${failedCount} failed${colors.reset}` : '0 failed'}`
  );
  console.log(`${colors.bold}═══════════════════════════════════════════════════════════════${colors.reset}\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Smoke test harness fatal error:', err);
  process.exit(1);
});
