import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

const serviceFile = resolve('src/services/recordingService.js');
const commandFile = resolve('src/commands/utility/record.js');

const serviceOriginal = readFileSync(serviceFile, 'utf8');
const commandOriginal = readFileSync(commandFile, 'utf8');

function cleanup() {
  writeFileSync(serviceFile, serviceOriginal, 'utf8');
  writeFileSync(commandFile, commandOriginal, 'utf8');
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  cleanup();
  console.error('Uncaught exception in mutation runner:', err);
  process.exit(1);
});

const mutants = [
  {
    id: 'MUT-01',
    file: serviceFile,
    name: '24/7 Enabled Boolean Inversion',
    search: 'is247Enabled = Boolean(settings?.twentyFourSeven?.enabled);',
    replace: 'is247Enabled = !Boolean(settings?.twentyFourSeven?.enabled);'
  },
  {
    id: 'MUT-02',
    file: serviceFile,
    name: '24/7 Connection Retention Condition Negation',
    search: 'if (is247Enabled) {',
    replace: 'if (false) {'
  },
  {
    id: 'MUT-03',
    file: serviceFile,
    name: 'Connection Destroy Suppressed in Non-24/7 Mode',
    search: 'session.connection?.destroy?.();',
    replace: '/* session.connection?.destroy?.(); */'
  },
  {
    id: 'MUT-04',
    file: serviceFile,
    name: 'Voice Deafen Inversion on 24/7 Standby',
    search: 'await guild.members.me.voice.setDeaf(true).catch(() => {});',
    replace: 'await guild.members.me.voice.setDeaf(false).catch(() => {});'
  },
  {
    id: 'MUT-05',
    file: serviceFile,
    name: 'Zero-byte Audio Detection Inversion',
    search: 'if (session.bytesWritten === 0 || pcmSize === 0) {',
    replace: 'if (session.bytesWritten > 0 && pcmSize > 0) {'
  },
  {
    id: 'MUT-06',
    file: serviceFile,
    name: 'Active Recording Guard Inversion (startRecording)',
    search: 'if (this.activeRecordings.has(guildId)) {',
    replace: 'if (!this.activeRecordings.has(guildId)) {'
  },
  {
    id: 'MUT-07',
    file: serviceFile,
    name: 'Direct DM Error Suppression (Retry Bypass)',
    search: 'const dmChannel = await targetUser.createDM();',
    replace: 'throw new Error("createDM bypassed");'
  },
  {
    id: 'MUT-08',
    file: serviceFile,
    name: 'Text Channel Fallback Disabled',
    search: 'if (!delivered && session.textChannel) {',
    replace: 'if (false && session.textChannel) {'
  },
  {
    id: 'MUT-09',
    file: commandFile,
    name: 'Bot Owner Restriction Disabled in Command Flag',
    search: 'export const botOwnerOnly = true;',
    replace: 'export const botOwnerOnly = false;'
  },
  {
    id: 'MUT-10',
    file: commandFile,
    name: 'Owner Check Inversion in executeRecord',
    search: 'if (!isOwner(user.id, appContext, client)) {',
    replace: 'if (isOwner(user.id, appContext, client)) {'
  },
  {
    id: 'MUT-11',
    file: commandFile,
    name: 'Unknown Interaction Code Check Mutation (10062 -> 99999)',
    search: 'if (err.code === 10062) {',
    replace: 'if (err.code === 99999) {'
  },
  {
    id: 'MUT-12',
    file: commandFile,
    name: 'Already-Recording Check Inversion in record start',
    search: 'if (recordingService.isRecording(guildId)) {',
    replace: 'if (!recordingService.isRecording(guildId)) {'
  },
  {
    id: 'MUT-13',
    file: commandFile,
    name: 'No-Active-Session Check Inversion in record stop',
    search: 'if (!session) {',
    replace: 'if (session) {'
  },
  {
    id: 'MUT-14',
    file: commandFile,
    name: 'Missing Voice Channel Guard Inversion in record start',
    search: 'if (!voiceChannel) {',
    replace: 'if (voiceChannel) {'
  },
  {
    id: 'MUT-15',
    file: commandFile,
    name: 'Guild Scope Guard Inversion in record command',
    search: 'if (!guild) {',
    replace: 'if (guild) {'
  }
];

console.log(`${colors.bold}═══════════════════════════════════════════════════════════════${colors.reset}`);
console.log(`${colors.bold}          WORLD TREE MUTATION TESTING SUITE                    ${colors.reset}`);
console.log(`${colors.bold}═══════════════════════════════════════════════════════════════${colors.reset}`);
console.log(`Targets:`);
console.log(` - ${serviceFile}`);
console.log(` - ${commandFile}`);
console.log(`Total Mutants: ${mutants.length}\n`);

let killedCount = 0;
let survivedCount = 0;

for (const mutant of mutants) {
  const fileContent = mutant.file === serviceFile ? serviceOriginal : commandOriginal;

  if (!fileContent.includes(mutant.search)) {
    console.error(`[ERROR] Search target not found for mutant ${mutant.id}: "${mutant.search}"`);
    continue;
  }

  const mutatedContent = fileContent.replace(mutant.search, mutant.replace);
  writeFileSync(mutant.file, mutatedContent, 'utf8');

  let testFailed = false;
  let failureSnippet = '';

  try {
    execSync('node --test test/recordingCommand.test.js test/recordingService.test.js', {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 25000
    });
  } catch (err) {
    testFailed = true;
    const stderr = err.stderr || '';
    const stdout = err.stdout || '';
    const output = stdout + '\n' + stderr;
    const failMatch = output.match(/✖\s+([^\n\r]+)/);
    failureSnippet = failMatch ? failMatch[1].trim() : 'Assertion failed or process exited with error';
  } finally {
    cleanup();
  }

  if (testFailed) {
    killedCount++;
    console.log(
      `  ${colors.green}✔ KILLED${colors.reset}   [${mutant.id}] ${colors.bold}${mutant.name}${colors.reset}`
    );
    console.log(`             └─ Caught by: "${failureSnippet.slice(0, 80)}"`);
  } else {
    survivedCount++;
    console.log(`  ${colors.red}✖ SURVIVED${colors.reset} [${mutant.id}] ${colors.bold}${mutant.name}${colors.reset}`);
    console.log(`             └─ Warning: Tests did not catch this mutation!`);
  }
}

cleanup();

const total = killedCount + survivedCount;
const score = total > 0 ? ((killedCount / total) * 100).toFixed(1) : '0.0';

console.log(`\n${colors.bold}═══════════════════════════════════════════════════════════════${colors.reset}`);
console.log(`Mutation Test Results:`);
console.log(`  Total Mutants Tested : ${total}`);
console.log(`  Mutants Killed (PASS): ${colors.green}${killedCount}${colors.reset}`);
console.log(`  Mutants Survived     : ${survivedCount > 0 ? `${colors.red}${survivedCount}${colors.reset}` : '0'}`);
console.log(
  `  Mutation Score       : ${score === '100.0' ? `${colors.green}${score}%${colors.reset}` : `${colors.yellow}${score}%${colors.reset}`}`
);
console.log(`${colors.bold}═══════════════════════════════════════════════════════════════${colors.reset}\n`);

if (survivedCount > 0) {
  process.exit(1);
}
