import axios from "axios"
import fs from "fs"

// Maps the file extension multer saved the upload with to the `format`
// value OpenRouter's transcription endpoint expects. The frontend's
// MediaRecorder determines the real extension (webm in Chrome/Firefox,
// mp4 in Safari) — this just normalizes a few common cases.
const resolveFormat = (filePath) => {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const known = ["webm", "mp3", "mp4", "wav", "flac", "ogg", "m4a"];
    return known.includes(ext) ? ext : "webm";
};

export const transcribeAudio = async (filePath) => {
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error("Audio file not found.");
        }

        const audioBuffer = fs.readFileSync(filePath);
        const audioBase64 = audioBuffer.toString("base64");
        const format = resolveFormat(filePath);

        const response = await axios.post(
            "https://openrouter.ai/api/v1/audio/transcriptions",
            {
                model: "openai/whisper-large-v3",
                input_audio: {
                    data: audioBase64,
                    format,
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                },
                // Audio transcription can take longer than a typical chat call,
                // especially for answers near the 90-120s time limit.
                timeout: 60000,
            }
        );

        const text = response?.data?.text;

        if (typeof text !== "string" || !text.trim()) {
            // Not necessarily an error — silence/near-silence audio legitimately
            // produces this. The caller decides how to surface it to the user.
            return "";
        }

        return text.trim();
    } catch (error) {
        console.error("Whisper Transcription Error:", error.response?.data || error.message);
        throw new Error("Transcription failed.");
    }
};