/**
 * Channel A: Baseline JavaScript Audio Engine Wrapper.
 * Encapsulates standard discord-player stream dispatcher.
 */
export class JsAudioEngine {
  constructor(playerService) {
    this.playerService = playerService;
  }

  isAvailable() {
    return true;
  }

  getEngineName() {
    return 'JavaScript (discord-player / ffmpeg)';
  }
}
