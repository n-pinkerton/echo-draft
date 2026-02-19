export async function getOrCreateAudioContext(manager) {
  if (manager.persistentAudioContext && manager.persistentAudioContext.state !== "closed") {
    if (manager.persistentAudioContext.state === "suspended") {
      await manager.persistentAudioContext.resume();
    }
    return manager.persistentAudioContext;
  }
  manager.persistentAudioContext = new AudioContext({ sampleRate: 16000 });
  manager.workletModuleLoaded = false;
  return manager.persistentAudioContext;
}

