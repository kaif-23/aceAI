import mongoose from "mongoose";

const questionsSchema = new mongoose.Schema({
    question: String,
    difficulty: String,
    timeLimit: Number,
    // Short spoken line said right before this question, referencing the previous
    // topic where possible. Empty string for question 1 (intro already covers that).
    transition: { type: String, default: "" },
    // Which topic (0-indexed, out of the planned topics) this question belongs to.
    topicIndex: { type: Number, default: 0 },
    // True if this question is a follow-up on the same topic rather than a new topic.
    isFollowUp: { type: Boolean, default: false },
    answer: String,
    // Spoken aloud immediately after the answer is submitted — short, casual, no scores.
    spokenReaction: String,
    // Rubric-style feedback — saved silently, only ever shown in the Step 3 report.
    // Now covers: what was good, what was missing, one concrete suggestion.
    feedback: String,
    score: { type: Number, default: 0 },
    // Field names kept stable for backward compatibility with the existing report
    // UI/PDF export, but the MEANING of each is now more specific:
    // confidence    -> "Delivery confidence", derived from time used, filler words,
    //                  and hedging language in the transcript (text-only signal).
    confidence: { type: Number, default: 0 },
    // communication -> "Structure & Clarity": is the answer organized and easy to follow.
    communication: { type: Number, default: 0 },
    // correctness   -> mode-aware: technical accuracy (Technical) or sound judgment/
    //                  relevance (HR), scored against explicit behavioral anchors.
    correctness: { type: Number, default: 0 },
    // New: concrete examples/details vs. generic, rehearsed-sounding answers.
    specificity: { type: Number, default: 0 },
})


const interviewSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    role: {
        type: String,
        required: true
    },
    experience: {
        type: String,
        required: true
    },
    mode: {
        type: String,
        enum: ["HR", "Technical"],
        required: true
    },
    resumeText: {
        type: String
    },
    questions: [questionsSchema],

    // The 5 topic labels planned up front (e.g. "React project", "team conflict
    // handling", "Node.js internals"). These are SUBJECTS, not phrased questions —
    // the actual question text for each topic is generated just-in-time so it can
    // react to everything said so far. Topic 0's first question is generated
    // immediately; topics 1-4 are generated only when the interview reaches them.
    plannedTopics: { type: [String], default: [] },

    // Which planned topic we're currently on (0-indexed).
    currentTopicIndex: { type: Number, default: 0 },

    // Whether the current topic has already used its one allowed follow-up.
    // Reset to false every time we move to a new topic.
    followUpUsedOnCurrentTopic: { type: Boolean, default: false },

    // Two-line spoken greeting, generated fresh per interview instead of being hard-coded.
    intro: { type: [String], default: [] },
    // Spoken closing line before the candidate is sent to the report screen.
    outro: { type: String, default: "" },

    finalScore: { type: Number, default: 0 },

    status: {
        type: String,
        enum: ["Incompleted", "completed"],
        default: "Incompleted",
    }
}, { timestamps: true })

const Interview = mongoose.model("Interview", interviewSchema)


export default Interview