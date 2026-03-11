import { useState } from 'react';
import { Mic, Square } from 'lucide-react';

interface AudioRecorderProps {
    onSend: (blob: Blob) => void;
    disabled?: boolean;
}

export default function AudioRecorder({ onSend, disabled }: AudioRecorderProps) {
    const [recording, setRecording] = useState(false);
    const [mediaRec, setMediaRec] = useState<MediaRecorder | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);

    const startRec = async () => {
        if (disabled) return;
        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mr = new MediaRecorder(audioStream);
            const chunks: BlobPart[] = [];
            mr.ondataavailable = (e) => chunks.push(e.data);
            mr.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                onSend(blob);
                audioStream.getTracks().forEach((t) => t.stop());
            };
            mr.start();
            setMediaRec(mr);
            setStream(audioStream);
            setRecording(true);
        } catch (err) {
            console.error('Microphone access denied', err);
            alert('Could not access microphone. Please check permissions.');
        }
    };

    const stopRec = () => {
        if (mediaRec && recording) {
            mediaRec.stop();
            setRecording(false);
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
            }
        }
    };

    if (recording) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '8px 16px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: 'var(--radius)',
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
            }}>
                <div style={{ width: 10, height: 10, background: '#ef4444', borderRadius: '50%' }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#ef4444', flex: 1 }}>Recording...</span>
                <button
                    onClick={stopRec}
                    style={{
                        padding: '8px',
                        background: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                    title="Stop and Send"
                >
                    <Square size={14} fill="white" />
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={startRec}
            disabled={disabled}
            style={{
                padding: '12px',
                borderRadius: 'var(--radius)',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: disabled ? 'var(--bg-secondary)' : 'var(--accent)',
                color: disabled ? 'var(--text-muted)' : '#fff',
                border: disabled ? '1px solid var(--border)' : 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                boxShadow: disabled ? 'none' : 'var(--shadow-glow)'
            }}
            title="Send Voice Message"
        >
            <Mic size={20} />
        </button>
    );
}
