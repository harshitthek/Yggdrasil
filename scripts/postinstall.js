import { existsSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const nodeModulesDir = join(rootDir, 'node_modules');

function setupYtDlp() {
  if (process.env.YOUTUBE_DL_SKIP_DOWNLOAD === 'true') {
    return;
  }

  const ytdlExecScript = join(nodeModulesDir, 'youtube-dl-exec', 'scripts', 'postinstall.js');
  if (existsSync(ytdlExecScript)) {
    try {
      execSync(`node "${ytdlExecScript}"`, { stdio: 'ignore' });
    } catch {}
  }

  if (platform() === 'linux') {
    const targetYtDlp = join(nodeModulesDir, 'youtube-dl-exec', 'bin', 'yt-dlp');
    const systemYtDlp = ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'].find((p) => existsSync(p));

    if (systemYtDlp) {
      try {
        if (existsSync(targetYtDlp)) unlinkSync(targetYtDlp);
        symlinkSync(systemYtDlp, targetYtDlp);
      } catch {}
    }
  }
}

function setupFFmpeg() {
  if (platform() === 'linux') {
    const targetFFmpeg = join(nodeModulesDir, 'ffmpeg-static', 'ffmpeg');
    const systemFFmpeg = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p));

    if (systemFFmpeg) {
      try {
        if (existsSync(targetFFmpeg)) unlinkSync(targetFFmpeg);
        symlinkSync(systemFFmpeg, targetFFmpeg);
      } catch {}
    }
  }
}

try {
  setupYtDlp();
  setupFFmpeg();
} catch {}
