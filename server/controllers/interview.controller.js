import fs from "fs"
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { askAi } from "../services/openRouter.service.js";
import { transcribeAudio } from "../services/whisper.service.js";
import User from "../models/user.model.js";
import Interview from "../models/interview.model.js";

export const analyzeResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Resume required" });
    }
    const filepath = req.file.path

    const fileBuffer = await fs.promises.readFile(filepath)
    const uint8Array = new Uint8Array(fileBuffer)

    const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;

    let resumeText = "";

    // Extract text from all pages
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const pageText = content.items.map(item => item.str).join(" ");
      resumeText += pageText + "\n";
    }


    resumeText = resumeText
      .replace(/\s+/g, " ")
      .trim();

    const messages = [
      {
        role: "system",
        content: `
Extract structured data from resume.

Return strictly JSON:

{
  "role": "string",
  "experience": "string",
  "projects": ["project1", "project2"],
  "skills": ["skill1", "skill2"]
}
`
      },
      {
        role: "user",
        content: resumeText
      }
    ];


    const aiResponse = await askAi(messages)

    const parsed = JSON.parse(aiResponse);

    fs.unlinkSync(filepath)


    res.json({
      role: parsed.role,
      experience: parsed.experience,
      projects: parsed.projects,
      skills: parsed.skills,
      resumeText
    });

  } catch (error) {
    console.error(error);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({ message: error.message });
  }
};


export const transcribeAnswer = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Audio file required" });
    }

    const filepath = req.file.path;

    const transcript = await transcribeAudio(filepath);

    fs.unlinkSync(filepath);

    return res.status(200).json({ transcript });
  } catch (error) {
    console.error(error);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({ message: error.message });
  }
};


export const generateQuestion = async (req, res) => {
  try {
    let { role, experience, mode, resumeText, projects, skills } = req.body

    role = role?.trim();
    experience = experience?.trim();
    mode = mode?.trim();

    if (!role || !experience || !mode) {
      return res.status(400).json({ message: "Role, Experience and Mode are required." })
    }

    const user = await User.findById(req.userId)

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    if (user.credits < 50) {
      return res.status(400).json({
        message: "Not enough credits. Minimum 50 required."
      });
    }

    const projectText = Array.isArray(projects) && projects.length
      ? projects.join(", ")
      : "None";

    const skillsText = Array.isArray(skills) && skills.length
      ? skills.join(", ")
      : "None";

    const safeResume = resumeText?.trim() || "None";

    const userPrompt = `
    Role:${role}
    Experience:${experience}
    InterviewMode:${mode}
    Projects:${projectText}
    Skills:${skillsText},
    Resume:${safeResume}
    `;

    if (!userPrompt.trim()) {
      return res.status(400).json({
        message: "Prompt content is empty."
      });
    }

    // STEP A — Plan 5 topic SUBJECTS (not phrased questions yet) grounded in the
    // resume/role/skills, and write the intro + the very first question (topic 1).
    // Topics 2-5 stay as short labels until the interview actually reaches them —
    // that's what lets the real question text adapt to everything said so far.
    const messages = [
      {
        role: "system",
        content: `
You are Ridhi, a senior ${mode === "Technical" ? "engineering" : "HR"} interviewer
at a mid-sized tech company, conducting a real interview for a ${role} position.
You've reviewed this candidate's resume beforehand and have genuine opinions about
what's interesting or thin in it — you're curious about specifics, not just going
through a script. Speak the way an experienced interviewer actually does: warm but
efficient, never robotic or generic.

Your job right now has two parts:

PART 1 — Plan exactly 5 topics for this interview (topics, not full questions).
- Base every topic on the candidate's role, experience, interviewMode, projects,
  skills, and resume details. Be specific (e.g. "the React inventory dashboard
  project" not just "a project").
- interviewMode is "${mode}". This controls what KIND of topics you plan:
  ${mode === "Technical"
            ? `Every topic must test technical depth — architecture decisions, tools,
  tradeoffs, debugging, system design, or hands-on implementation details from
  THIS candidate's specific projects/skills. Do NOT plan generic behavioral
  topics (teamwork, conflict, motivation) — this is a technical-only round.`
            : `This is an HR / behavioral round — NOT a technical round. Every topic
  must test soft skills, judgment, motivation, communication, and past
  behavior: teamwork, conflict resolution, ownership, handling pressure,
  career motivation, why this role/company, strengths/weaknesses. You may
  reference a project by NAME from their resume as the SETTING for a
  behavioral question (e.g. "a time during the inventory dashboard project
  when priorities changed"), but NEVER ask them to explain technical
  implementation, architecture, code, or tools — that belongs to a separate
  technical round and is OUT OF SCOPE here.`}
- Order topics so difficulty roughly increases: topics 1-2 easier/foundational,
  topics 3-4 more applied, topic 5 the most challenging or open-ended.
- Each topic is a short internal label (3 to 8 words), never shown to the candidate
  directly as-is.

PART 2 — Greeting + the FIRST actual question only.
- "intro": array of exactly 2 short, warm greeting lines, varied wording each time,
  naturally mentioning the candidate's name once, leading into starting.
- "firstQuestion": the actual spoken question for topic 1 — 15 to 25 words, one
  complete sentence, simple conversational English, no numbering. It MUST match
  the "${mode}" mode constraint above — ${mode === "Technical"
            ? "a technical question testing real depth, not small talk."
            : "a behavioral/HR question, never a technical implementation question."}

Do NOT write questions for topics 2 to 5 yet — only the topic label for those.

Return ONLY valid JSON, no extra text before or after, in exactly this shape:

{
  "intro": ["line 1", "line 2"],
  "topics": ["topic 1 label", "topic 2 label", "topic 3 label", "topic 4 label", "topic 5 label"],
  "firstQuestion": "string"
}
`
      },
      {
        role: "user",
        content: userPrompt
      }
    ];

    const aiResponse = await askAi(messages)

    if (!aiResponse || !aiResponse.trim()) {
      return res.status(500).json({
        message: "AI returned empty response."
      });
    }

    let parsedPlan;
    try {
      parsedPlan = JSON.parse(aiResponse);
    } catch {
      return res.status(500).json({
        message: "AI returned an unexpected format."
      });
    }

    const plannedTopics = Array.isArray(parsedPlan.topics) && parsedPlan.topics.length
      ? parsedPlan.topics.slice(0, 5)
      : [];

    const firstQuestionText = typeof parsedPlan.firstQuestion === "string"
      ? parsedPlan.firstQuestion.trim()
      : "";

    if (plannedTopics.length === 0 || !firstQuestionText) {
      return res.status(500).json({
        message: "AI failed to plan the interview."
      });
    }

    const introLines = Array.isArray(parsedPlan.intro) && parsedPlan.intro.length
      ? parsedPlan.intro.slice(0, 2)
      : [
        `Hi ${user.name}, it's great to meet you today.`,
        "I'll ask you a few questions. Let's begin."
      ];

    user.credits -= 50;
    await user.save();

    const interview = await Interview.create({
      userId: user._id,
      role,
      experience,
      mode,
      resumeText: safeResume,
      intro: introLines,
      plannedTopics,
      currentTopicIndex: 0,
      followUpUsedOnCurrentTopic: false,
      questions: [
        {
          question: firstQuestionText,
          transition: "",
          topicIndex: 0,
          isFollowUp: false,
          difficulty: "easy",
          timeLimit: 60,
        }
      ]
    })

    res.json({
      interviewId: interview._id,
      creditsLeft: user.credits,
      userName: user.name,
      intro: interview.intro,
      totalTopics: plannedTopics.length,
      // Only the question(s) asked so far are ever sent to the client —
      // never the full plan, so future topics can't leak ahead of time.
      questions: interview.questions
    });
  } catch (error) {
    return res.status(500).json({ message: `failed to create interview ${error}` })
  }
}


// Generates one warm, varied closing line once the interview is actually done.
// Falls back to a safe default if the call fails — finishing must never block on this.
async function generateOutro(role) {
  let outroLine = "Thanks for your time today, that brings us to the end of the interview.";
  try {
    const outroMessages = [
      {
        role: "system",
        content: `
You are Ridhi, the interviewer wrapping up an interview for a ${role || "the"} position
that just finished. Write ONE warm, professional closing line (1 to 2 sentences),
thanking the candidate for their time and naturally referencing the role they
interviewed for. Vary the wording — do not use generic stock phrasing. Return ONLY
the line of text, nothing else, no quotes around it.
`
      },
      { role: "user", content: "The interview just ended." }
    ];
    const outroResponse = await askAi(outroMessages);
    if (outroResponse && outroResponse.trim()) {
      outroLine = outroResponse.trim();
    }
  } catch {
    // Keep the fallback outroLine.
  }
  return outroLine;
}

// Used when an answer is skipped or times out. There is nothing to follow up
// on in either case, so we always deterministically move to the next planned
// topic (never call the follow-up decision logic) and only ask the LLM to
// phrase that next topic's opening question.
async function advancePastUnscoredQuestion(interview) {
  const totalTopics = interview.plannedTopics.length;
  const isFinalTopic = interview.currentTopicIndex >= totalTopics - 1;

  if (isFinalTopic) {
    interview.status = "completed";
    const outroLine = await generateOutro(interview.role);
    interview.outro = outroLine;
    await interview.save();
    return { interviewComplete: true, outro: outroLine };
  }

  const nextTopicIndex = interview.currentTopicIndex + 1;
  const nextTopicLabel = interview.plannedTopics[nextTopicIndex];
  const mode = interview.mode;

  const messages = [
    {
      role: "system",
      content: `
You are Ridhi, a human interviewer. The candidate did not answer the previous
question in time, so you are moving on without dwelling on it.

This is a "${mode}" round. ${mode === "Technical"
          ? "The next question MUST be technical — test real implementation/architecture depth, never small talk or behavioral framing."
          : "The next question MUST be behavioral/HR — about judgment, teamwork, motivation, or experience. NEVER ask about technical implementation, code, or architecture."}

Write:
- "transition": one short, kind, natural spoken line (6-14 words) that moves
  things along without making the candidate feel bad about missing it.
- "nextQuestion": the opening question for the new topic "${nextTopicLabel}",
  15 to 25 words, one complete sentence, simple conversational English.

Return ONLY valid JSON: { "transition": "string", "nextQuestion": "string" }
`
    },
    {
      role: "user",
      content: `New topic: ${nextTopicLabel}`
    }
  ];

  let nextQuestionText = `Let's move on — can you tell me about ${nextTopicLabel}?`;
  let transitionText = "No worries, let's keep going.";

  try {
    const aiResponse = await askAi(messages);
    const parsed = JSON.parse(aiResponse);
    if (parsed.nextQuestion) nextQuestionText = parsed.nextQuestion.trim();
    if (parsed.transition) transitionText = parsed.transition.trim();
  } catch {
    // Fall back to the safe defaults above if the model call/parse fails —
    // the interview must still be able to proceed.
  }

  interview.currentTopicIndex = nextTopicIndex;
  interview.followUpUsedOnCurrentTopic = false;

  const difficultyByTopic = ["easy", "easy", "medium", "medium", "hard"];
  const timeLimitByTopic = [60, 60, 90, 90, 120];

  interview.questions.push({
    question: nextQuestionText,
    transition: transitionText,
    topicIndex: nextTopicIndex,
    isFollowUp: false,
    difficulty: difficultyByTopic[nextTopicIndex] || "medium",
    timeLimit: timeLimitByTopic[nextTopicIndex] || 90,
  });

  await interview.save();

  return {
    nextQuestion: interview.questions[interview.questions.length - 1],
    interviewComplete: false
  };
}

export const submitAnswer = async (req, res) => {
  try {
    const { interviewId, questionIndex, answer, timeTaken } = req.body

    const interview = await Interview.findById(interviewId)
    const question = interview.questions[questionIndex]

    const totalTopics = interview.plannedTopics.length;
    const isFinalTopic = interview.currentTopicIndex >= totalTopics - 1;

    // If no answer
    if (!answer) {
      question.score = 0;
      question.spokenReaction = "Okay, let's move on.";
      question.feedback = "No answer was submitted for this question.";
      question.answer = "";

      const result = await advancePastUnscoredQuestion(interview);
      return res.json({
        spokenReaction: question.spokenReaction,
        ...result
      });
    }

    // If time exceeded
    if (timeTaken > question.timeLimit) {
      question.score = 0;
      question.spokenReaction = "Time's up, let's continue.";
      question.feedback = "Time limit exceeded. Answer not evaluated.";
      question.answer = answer;

      const result = await advancePastUnscoredQuestion(interview);
      return res.json({
        spokenReaction: question.spokenReaction,
        ...result
      });
    }

    // ---- Build context: the topic this question belongs to, and whether a
    // follow-up is still allowed on it (server-enforced cap, not model-trusted).
    const topicLabel = interview.plannedTopics[question.topicIndex] || "general";
    const followUpAllowed = !interview.followUpUsedOnCurrentTopic;

    const messages = [
      {
        role: "system",
        content: `
You are Ridhi, a senior ${interview.mode === "Technical" ? "engineering" : "HR"}
interviewer conducting a real, adaptive interview for a ${interview.role} position.
You react to what the candidate ACTUALLY said, not in generic templates.

You must do THREE things in one response:

1) SCORE the candidate's answer (0 to 10 each), using these anchors —
   do not just guess a number, anchor it against this scale for EVERY parameter:
   0-3: Off-topic, contradicts itself, or shows no real understanding.
   4-6: Answers the question but stays generic/surface-level, no concrete example.
   7-8: Specific, relevant, has at least one concrete detail or example.
   9-10: Specific, structured, and demonstrates depth a typical candidate wouldn't show.

   - correctness: ${interview.mode === "Technical"
            ? `Is the technical content accurate and specific, and does it show real
   hands-on understanding rather than textbook/rehearsed phrasing? Relevant to
   THIS topic: "${topicLabel}".`
            : `Does the answer show genuine self-awareness, sound judgment, and
   relevant real experience for THIS topic: "${topicLabel}"? Not just the "correct"
   textbook answer to a behavioral question.`}
   - communication: Is the answer organized and easy to follow (clear structure,
     gets to the point), as opposed to rambling or disorganized — regardless of
     how good the content itself is.
   - specificity: Does the answer include concrete examples, numbers, names, or
     details — versus vague, generic, could-apply-to-anyone phrasing?
   - confidence: Judge this ONLY from these measurable text signals, not vibes:
       a) time used (${timeTaken ?? "unknown"}s out of ${question.timeLimit}s limit) —
          using nearly all the time with an incomplete-feeling answer suggests
          hesitation; using very little time with a complete answer suggests confidence.
       b) filler words in the transcript ("um", "uh", "like", "you know") — count
          their density, more fillers = lower confidence.
       c) hedging language ("I think", "maybe", "I'm not totally sure", "sort of",
          "I guess") — more hedging = lower confidence.
     Do NOT infer confidence from word choice sophistication or content quality —
     that belongs to the other three parameters, not this one.
   finalScore = average of the four, rounded to nearest whole number.

2) DECIDE the next step: "follow_up" or "next_topic".
   ${followUpAllowed
            ? `- Choose "follow_up" if EITHER:
     a) the answer is vague, incomplete, dodges the question, or is missing an
        obvious concrete detail (example, number, name) that a real interviewer
        would naturally probe for, OR
     b) the answer is strong and mentions something specific worth digging deeper
        into (a number, a decision, a tradeoff, a result) that a sharp interviewer
        would naturally chase rather than move past.
   - Choose "next_topic" only when the answer is adequately covered either way —
     not vague enough to need probing, and not so specific that you have an
     obvious, sharp follow-up to ask.`
            : `- A follow-up has ALREADY been used on this topic. You MUST choose "next_topic"
   regardless of answer quality. Do not pick "follow_up" again.`
          }

3) Based on that decision, write the next thing to say. This is a "${interview.mode}"
   round — ${interview.mode === "Technical"
            ? "every question you write must stay technical (implementation, architecture, tradeoffs, debugging), never behavioral/HR framing."
            : "every question you write must stay behavioral/HR (judgment, teamwork, motivation, experience), NEVER ask for technical implementation, code, or architecture details."}
   - If "follow_up": write "nextQuestion" as a natural, specific follow-up that
     either probes what was missing/vague, OR digs deeper into a specific point
     they raised — reference something the candidate actually said. 15 to 25 words.
   - If "next_topic": write "nextQuestion" as the opening question for this NEW
     topic: "${interview.currentTopicIndex + 1 < totalTopics ? interview.plannedTopics[interview.currentTopicIndex + 1] : "a closing reflection on the interview overall"}".
     15 to 25 words, grounded in the candidate's role/resume where relevant.
   - Also write "transition": one short natural spoken line (6-14 words) bridging
     from this answer into "nextQuestion" — reference what they just said if
     relevant. Never mention scores.
   ${isFinalTopic && !followUpAllowed ? `- This is the FINAL topic and no follow-up remains: set "interviewComplete": true and "nextQuestion": "".` : ""}

You must also produce TWO separate pieces of feedback on the answer just given:

spokenReaction (said OUT LOUD immediately, mid-interview):
- 4 to 10 words. React to something SPECIFIC they said, not a generic compliment.
  e.g. "Oh interesting, the caching approach you mentioned" not "Nice, great example."
- NEVER mention scores, numbers, or evaluation words.

feedback (written, private report only, NEVER spoken, 25 to 40 words):
- Cover all three: (1) what was good about THIS specific answer, (2) what was
  missing or could be stronger, (3) one concrete, actionable suggestion.
- Reference what they actually said — never generic phrasing like "could be
  more detailed" with no specifics attached.

Return ONLY valid JSON, no extra text, in exactly this shape:
{
  "confidence": number,
  "communication": number,
  "correctness": number,
  "specificity": number,
  "finalScore": number,
  "spokenReaction": "string",
  "feedback": "string",
  "decision": "follow_up" | "next_topic",
  "transition": "string",
  "nextQuestion": "string",
  "interviewComplete": boolean
}
`
      },
      {
        role: "user",
        content: `
Topic: ${topicLabel}
Question asked: ${question.question}
Time used: ${timeTaken ?? "unknown"} seconds (limit: ${question.timeLimit} seconds)
Candidate's answer (transcript): ${answer}
`
      }
    ];

    const aiResponse = await askAi(messages)
    const parsed = JSON.parse(aiResponse);

    question.answer = answer;
    question.confidence = parsed.confidence;
    question.communication = parsed.communication;
    question.correctness = parsed.correctness;
    question.specificity = parsed.specificity;
    question.score = parsed.finalScore;
    question.spokenReaction = parsed.spokenReaction;
    question.feedback = parsed.feedback;

    // Server-enforced rule: the model is only ALLOWED to follow up if the cap
    // hasn't been used yet on this topic. If the model ignores the instruction
    // and says follow_up anyway when it's not allowed, we override it here —
    // this is the part we never trust to the model alone.
    let decision = parsed.decision === "follow_up" && followUpAllowed
      ? "follow_up"
      : "next_topic";

    const interviewComplete = decision === "next_topic" && isFinalTopic;

    if (interviewComplete) {
      interview.status = "completed";
      const outroLine = await generateOutro(interview.role);
      interview.outro = outroLine;
      await interview.save();

      return res.status(200).json({
        spokenReaction: parsed.spokenReaction,
        outro: outroLine,
        interviewComplete: true
      });
    }

    let nextQuestionText = (parsed.nextQuestion || "").trim();
    let nextTransition = (parsed.transition || "").trim();

    if (decision === "follow_up") {
      interview.followUpUsedOnCurrentTopic = true;
      interview.questions.push({
        question: nextQuestionText,
        transition: nextTransition,
        topicIndex: question.topicIndex,
        isFollowUp: true,
        difficulty: question.difficulty,
        timeLimit: question.timeLimit,
      });
    } else {
      interview.currentTopicIndex += 1;
      interview.followUpUsedOnCurrentTopic = false;
      const difficultyByTopic = ["easy", "easy", "medium", "medium", "hard"];
      const timeLimitByTopic = [60, 60, 90, 90, 120];
      interview.questions.push({
        question: nextQuestionText,
        transition: nextTransition,
        topicIndex: interview.currentTopicIndex,
        isFollowUp: false,
        difficulty: difficultyByTopic[interview.currentTopicIndex] || "medium",
        timeLimit: timeLimitByTopic[interview.currentTopicIndex] || 90,
      });
    }

    await interview.save();

    return res.status(200).json({
      spokenReaction: parsed.spokenReaction,
      nextQuestion: interview.questions[interview.questions.length - 1],
      interviewComplete: false
    })
  } catch (error) {
    return res.status(500).json({ message: `failed to submit answer ${error}` })

  }
}


export const finishInterview = async (req, res) => {
  try {
    const { interviewId } = req.body
    const interview = await Interview.findById(interviewId)
    if (!interview) {
      return res.status(400).json({ message: "failed to find Interview" })
    }

    const totalQuestions = interview.questions.length;

    let totalScore = 0;
    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;
    let totalSpecificity = 0;

    interview.questions.forEach((q) => {
      totalScore += q.score || 0;
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
      totalSpecificity += q.specificity || 0;
    });

    const finalScore = totalQuestions
      ? totalScore / totalQuestions
      : 0;

    const avgConfidence = totalQuestions
      ? totalConfidence / totalQuestions
      : 0;

    const avgCommunication = totalQuestions
      ? totalCommunication / totalQuestions
      : 0;

    const avgCorrectness = totalQuestions
      ? totalCorrectness / totalQuestions
      : 0;

    const avgSpecificity = totalQuestions
      ? totalSpecificity / totalQuestions
      : 0;

    interview.finalScore = finalScore;
    interview.status = "completed";

    await interview.save();

    return res.status(200).json({
      finalScore: Number(finalScore.toFixed(1)),
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      specificity: Number(avgSpecificity.toFixed(1)),
      questionWiseScore: interview.questions.map((q) => ({
        question: q.question,
        score: q.score || 0,
        feedback: q.feedback || "",
        confidence: q.confidence || 0,
        communication: q.communication || 0,
        correctness: q.correctness || 0,
        specificity: q.specificity || 0,
      })),
    })
  } catch (error) {
    return res.status(500).json({ message: `failed to finish Interview ${error}` })
  }
}


export const getMyInterviews = async (req, res) => {
  try {
    const interviews = await Interview.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .select("role experience mode finalScore status createdAt");

    return res.status(200).json(interviews)

  } catch (error) {
    return res.status(500).json({ message: `failed to find currentUser Interview ${error}` })
  }
}

export const getInterviewReport = async (req, res) => {
  try {
    const interview = await Interview.findById(req.params.id)

    if (!interview) {
      return res.status(404).json({ message: "Interview not found" });
    }


    const totalQuestions = interview.questions.length;

    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;
    let totalSpecificity = 0;

    interview.questions.forEach((q) => {
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
      totalSpecificity += q.specificity || 0;
    });
    const avgConfidence = totalQuestions
      ? totalConfidence / totalQuestions
      : 0;

    const avgCommunication = totalQuestions
      ? totalCommunication / totalQuestions
      : 0;

    const avgCorrectness = totalQuestions
      ? totalCorrectness / totalQuestions
      : 0;

    const avgSpecificity = totalQuestions
      ? totalSpecificity / totalQuestions
      : 0;

    return res.json({
      finalScore: interview.finalScore,
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      specificity: Number(avgSpecificity.toFixed(1)),
      questionWiseScore: interview.questions
    });

  } catch (error) {
    return res.status(500).json({ message: `failed to find currentUser Interview report ${error}` })
  }
}