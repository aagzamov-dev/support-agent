import { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';

interface VoiceMessageProps {
    audioUrl: string;
    duration?: number;
    isUser?: boolean;
}

export default function VoiceMessage({ audioUrl, duration, isUser = false }: VoiceMessageProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [audioDuration, setAudioDuration] = useState(duration || 0);
    const [currentTime, setCurrentTime] = useState(0);

    const fullUrl = audioUrl.startsWith('http') ? audioUrl : `http://localhost:8000${audioUrl.startsWith('/') ? '' : '/'}${audioUrl}`;

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onTimeUpdate = () => {
            if (audio.duration) {
                setProgress((audio.currentTime / audio.duration) * 100);
            }
            setCurrentTime(audio.currentTime);
        };

        const onLoadedMetadata = () => {
            if (audio.duration && isFinite(audio.duration)) {
                setAudioDuration(audio.duration);
            }
        };

        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onEnded = () => {
            setIsPlaying(false);
            setProgress(0);
            setCurrentTime(0);
        };

        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('loadedmetadata', onLoadedMetadata);
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onEnded);

        // In case it's already loaded
        if (audio.duration && isFinite(audio.duration)) {
            setAudioDuration(audio.duration);
        }

        return () => {
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('loadedmetadata', onLoadedMetadata);
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onEnded);
        };
    }, [fullUrl]);

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) {
            audio.pause();
        } else {
            audio.play().catch(err => console.error("Playback failed:", err));
        }
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        const audio = audioRef.current;
        if (!audio || !audio.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        audio.currentTime = pct * audio.duration;
    };

    const formatTime = (s: number) => {
        if (!isFinite(s)) return "0:00";
        const min = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${min}:${sec.toString().padStart(2, '0')}`;
    };

    // Generate pseudo-waveform bars
    const bars = 28;
    const waveform = Array.from({ length: bars }, (_, i) => {
        const seed = (i * 7 + 3) % 13;
        return 0.2 + (seed / 13) * 0.8;
    });

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 220,
            maxWidth: 320,
        }}>
            <audio ref={audioRef} src={fullUrl} preload="metadata" />

            {/* Play/Pause button */}
            <button
                onClick={togglePlay}
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0,
                    background: isUser ? 'rgba(255,255,255,0.2)' : 'var(--accent)',
                    color: '#fff',
                    transition: 'transform 0.15s',
                }}
                onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.92)')}
                onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
                {isPlaying ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" style={{ marginLeft: 2 }} />}
            </button>

            {/* Waveform + time */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                    onClick={handleSeek}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        height: 28,
                        cursor: 'pointer',
                    }}
                >
                    {waveform.map((h, i) => {
                        const barPct = (i / bars) * 100;
                        const isActive = barPct <= progress;
                        return (
                            <div
                                key={i}
                                style={{
                                    flex: 1,
                                    height: `${h * 100}%`,
                                    borderRadius: 2,
                                    transition: 'background 0.15s',
                                    background: isActive
                                        ? (isUser ? 'rgba(255,255,255,0.9)' : 'var(--accent)')
                                        : (isUser ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)'),
                                }}
                            />
                        );
                    })}
                </div>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.65rem',
                    opacity: 0.7,
                    fontVariantNumeric: 'tabular-nums',
                }}>
                    <span>{formatTime(currentTime)}</span>
                    <span>{audioDuration > 0 ? formatTime(audioDuration) : '--:--'}</span>
                </div>
            </div>
        </div>
    );
}
