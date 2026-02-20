export function SoundWaveIcon({ size = 16 }: { size?: number }) {
  return (
    <div className="flex items-center justify-center gap-1">
      <div className="bg-white rounded-full" style={{ width: size * 0.25, height: size * 0.6 }} />
      <div className="bg-white rounded-full" style={{ width: size * 0.25, height: size }} />
      <div className="bg-white rounded-full" style={{ width: size * 0.25, height: size * 0.6 }} />
    </div>
  );
}

export function VoiceWaveIndicator({ isListening }: { isListening: boolean }) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className={`w-0.5 bg-white rounded-full transition-all duration-150 ${
            isListening ? "animate-pulse h-4" : "h-2"
          }`}
          style={{
            animationDelay: isListening ? `${i * 0.1}s` : "0s",
            animationDuration: isListening ? `${0.6 + i * 0.1}s` : "0s",
          }}
        />
      ))}
    </div>
  );
}

