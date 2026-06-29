import React from 'react'
import maleVideo from "../assets/videos/male-ai.mp4"
import femaleVideo from "../assets/videos/female-ai.mp4"
import Timer from './Timer'
import { motion } from "motion/react"
import { FaMicrophone, FaMicrophoneSlash } from "react-icons/fa";
import { useState } from 'react'
import { useRef } from 'react'
import { useEffect } from 'react'
import axios from "axios"
import { ServerUrl } from '../App'
import { BsArrowRight } from 'react-icons/bs'

function Step2Interview({ interviewData, onFinish }) {
  const { interviewId, userName, intro, totalTopics } = interviewData;
  const [isIntroPhase, setIsIntroPhase] = useState(true);

  const [isMicOn, setIsMicOn] = useState(true);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micError, setMicError] = useState("");
  const [isAIPlaying, setIsAIPlaying] = useState(false);

  // The question list now GROWS as the interview proceeds — it starts with only
  // the first question and gains one more each time submit-answer responds,
  // since later questions don't exist yet until the AI decides what's next.
  const [questions, setQuestions] = useState(interviewData.questions || []);
  const [outro, setOutro] = useState("");
  const [interviewComplete, setInterviewComplete] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const answerRef = useRef("");
  const [spokenReaction, setSpokenReaction] = useState("");
  const [timeLeft, setTimeLeft] = useState(
    questions[0]?.timeLimit || 60
  );
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceGender, setVoiceGender] = useState("female");
  const [subtitle, setSubtitle] = useState("");


  // Keep a ref mirror of `answer` so async code (mic finalization, submit)
  // always reads the LATEST value instead of a value captured in a stale
  // closure from an earlier render.
  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);

  const videoRef = useRef(null);

  const currentQuestion = questions[currentIndex];

  // Guards against re-running the intro lines when selectedVoice's reference
  // changes again later (window.speechSynthesis.onvoiceschanged can fire more
  // than once in several browsers as the voice list keeps populating) — without
  // this, a second voice-list event during/after the intro would re-trigger this
  // effect and either re-speak the intro or speak the question twice in a row.
  const introStartedRef = useRef(false);
  // Same idea, scoped to "has THIS question index already been spoken" so a
  // stray selectedVoice change mid-question can't trigger a duplicate.
  const lastSpokenIndexRef = useRef(-1);

  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;

      // Try known female voices first
      const femaleVoice =
        voices.find(v =>
          v.name.toLowerCase().includes("zira") ||
          v.name.toLowerCase().includes("samantha") ||
          v.name.toLowerCase().includes("female")
        );

      if (femaleVoice) {
        setSelectedVoice(femaleVoice);
        setVoiceGender("female");
        return;
      }

      // Try known male voices
      const maleVoice =
        voices.find(v =>
          v.name.toLowerCase().includes("david") ||
          v.name.toLowerCase().includes("mark") ||
          v.name.toLowerCase().includes("male")
        );

      if (maleVoice) {
        setSelectedVoice(maleVoice);
        setVoiceGender("male");
        return;
      }

      // Fallback: first voice (assume female)
      setSelectedVoice(voices[0]);
      setVoiceGender("female");
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

  }, [])

  const videoSource = voiceGender === "male" ? maleVideo : femaleVideo;


  /* ---------------- SPEAK FUNCTION ---------------- */
  const speakText = (text) => {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !selectedVoice) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      // Add natural pauses after commas and periods
      const humanText = text
        .replace(/,/g, ", ... ")
        .replace(/\./g, ". ... ");

      const utterance = new SpeechSynthesisUtterance(humanText);

      utterance.voice = selectedVoice;

      // Human-like pacing
      utterance.rate = 0.92;     // slightly slower than normal
      utterance.pitch = 1.05;    // small warmth
      utterance.volume = 1;

      utterance.onstart = () => {
        setIsAIPlaying(true);
        stopMic()
        videoRef.current?.play();
      };


      utterance.onend = () => {
        videoRef.current?.pause();
        videoRef.current.currentTime = 0;
        setIsAIPlaying(false);



        if (isMicOn) {
          startMic();
        }
        setTimeout(() => {
          setSubtitle("");
          resolve();
        }, 300);
      };


      setSubtitle(text);

      window.speechSynthesis.speak(utterance);
    });
  };


  useEffect(() => {
    if (!selectedVoice) {
      return;
    }
    const runIntro = async () => {
      if (isIntroPhase) {
        // Hard guard: even if this effect re-fires because selectedVoice's
        // reference changed again (onvoiceschanged can fire more than once),
        // the intro must only ever be spoken one time.
        if (introStartedRef.current) return;
        introStartedRef.current = true;

        const introLines = Array.isArray(intro) && intro.length
          ? intro
          : [
              `Hi ${userName}, it's great to meet you today.`,
              "I'll ask you a few questions. Let's begin."
            ];

        for (const line of introLines) {
          await speakText(line);
        }

        setIsIntroPhase(false)
      } else if (currentQuestion) {
        // Same guard as the intro, scoped per-question: prevents this branch
        // from re-speaking the same question if selectedVoice's reference
        // changes again while this question is already being asked.
        if (lastSpokenIndexRef.current === currentIndex) return;
        lastSpokenIndexRef.current = currentIndex;

        await new Promise(r => setTimeout(r, 800));

        // Speak this question's transition line (empty for question 1, since
        // the intro already leads into it) instead of a generic phrase.
        if (currentQuestion.transition) {
          await speakText(currentQuestion.transition);
        }

        await speakText(currentQuestion.question);

        if (isMicOn) {
          startMic();
        }
      }

    }

    runIntro()


  }, [selectedVoice, isIntroPhase, currentIndex])



  useEffect(() => {
    if (isIntroPhase) return;
    if (!currentQuestion) return;
    
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0;
        }
        return prev - 1

      })
    }, 1000);

    return () => clearInterval(timer)

  }, [isIntroPhase, currentIndex])

  useEffect(() => {
  if (!isIntroPhase && currentQuestion) {
    setTimeLeft(currentQuestion.timeLimit || 60);
  }
}, [currentIndex]);


  // Tracks whether the recorder is currently active, mirroring the old
  // recognitionActiveRef — lets stopMicAndTranscribe() know whether there's
  // actually anything in-flight worth waiting on.
  const recordingActiveRef = useRef(false);

  // Lazily creates (once) and returns the mic stream, asking for permission
  // only the first time it's needed rather than on component mount — this
  // avoids surprising the user with a permission prompt before the intro
  // has even finished speaking.
  const getMicStream = async () => {
    if (streamRef.current) return streamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicError("");
      return stream;
    } catch (err) {
      console.log(err);
      setMicError("Microphone access was denied. You can still type your answer below.");
      setIsMicOn(false);
      return null;
    }
  };

  const startMic = async () => {
    if (isAIPlaying) return;
    if (recordingActiveRef.current) return;

    const stream = await getMicStream();
    if (!stream) return;

    try {
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstart = () => {
        recordingActiveRef.current = true;
        setIsRecording(true);
      };

      recorder.onerror = () => {
        recordingActiveRef.current = false;
        setIsRecording(false);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
    } catch (err) {
      console.log(err);
    }
  };

  // Stops the recorder WITHOUT transcribing — used when the AI starts
  // speaking, since whatever was captured up to that point isn't a real
  // answer and shouldn't be sent for transcription.
  const stopMic = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recordingActiveRef.current) {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch { }
    }
    recordingActiveRef.current = false;
    setIsRecording(false);
  };

  // Stops the recorder AND transcribes whatever was captured, merging the
  // result into the existing answer text. This is the MediaRecorder
  // equivalent of the old stopMicAndWait(): MediaRecorder.stop() is async
  // (data + onstop fire a moment later), so we wait for that before
  // uploading, exactly like the old code waited for a final onresult.
  const stopMicAndTranscribe = () => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;

      if (!recorder || !recordingActiveRef.current) {
        resolve();
        return;
      }

      recorder.onstop = async () => {
        recordingActiveRef.current = false;
        setIsRecording(false);

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        audioChunksRef.current = [];

        // Don't bother uploading near-empty clips (e.g. user toggled mic on
        // and off without saying anything) — saves a request and avoids a
        // confusing "transcription failed" for what was just silence.
        if (audioBlob.size < 1000) {
          resolve();
          return;
        }

        await transcribeAndAppend(audioBlob);
        resolve();
      };

      try {
        recorder.stop();
      } catch {
        recordingActiveRef.current = false;
        setIsRecording(false);
        resolve();
      }

      // Safety net: never hang forever if onstop doesn't fire.
      setTimeout(resolve, 4000);
    });
  };

  // Uploads the recorded audio to the backend, gets the transcript back,
  // and merges it into the answer — same merge behavior as the old
  // onresult handler (appended, not replaced), so multiple start/stop
  // cycles within one answer all accumulate instead of overwriting.
  const transcribeAndAppend = async (audioBlob) => {
    setIsTranscribing(true);
    setMicError("");

    try {
      const extension = audioBlob.type.includes("mp4") ? "mp4" : "webm";
      const formData = new FormData();
      formData.append("audio", audioBlob, `answer.${extension}`);

      const result = await axios.post(
        ServerUrl + "/api/interview/transcribe",
        formData,
        { withCredentials: true }
      );

      const transcript = (result.data?.transcript || "").trim();

      if (transcript) {
        setAnswer((prev) => {
          const next = (prev + " " + transcript).trim();
          answerRef.current = next;
          return next;
        });
      } else {
        setMicError("Couldn't catch that — please try again or type your answer.");
      }
    } catch (err) {
      console.log(err);
      setMicError("Transcription failed. Please try again or type your answer.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleMic = async () => {
    if (isMicOn) {
      await stopMicAndTranscribe();
    } else {
      await startMic();
    }
    setIsMicOn((prev) => !prev);
  };


  const submitAnswer = async () => {
    if (isSubmitting || isTranscribing) return;
    setIsSubmitting(true)

    // Wait for any in-flight recording to stop AND be transcribed before
    // reading the final answer — this is what prevents "I definitely said
    // something but the report shows no answer" when the user finishes
    // speaking right as they click Submit.
    await stopMicAndTranscribe();
    const finalAnswer = answerRef.current.trim();
    // Reflect the settled value in the UI too, in case a late transcript
    // arrived after the last render but before this point.
    setAnswer(finalAnswer);

    try {
      const result = await axios.post(ServerUrl + "/api/interview/submit-answer", {
        interviewId,
        questionIndex: currentIndex,
        answer: finalAnswer,
        timeTaken:
          currentQuestion.timeLimit - timeLeft,
      } , {withCredentials:true})

      setSpokenReaction(result.data.spokenReaction)

      if (result.data.interviewComplete) {
        setInterviewComplete(true);
        const finalOutro = result.data.outro || "";
        setOutro(finalOutro);

        // Speak the reaction to the final answer, then the outro right after,
        // back-to-back, then automatically finish and navigate to the report —
        // no manual "Interview Completed" click needed, this is the natural
        // end of the conversation.
        (async () => {
          await speakText(result.data.spokenReaction);
          if (finalOutro) await speakText(finalOutro);
          if (!isFinishing) {
            setIsFinishing(true);
            await finishInterview();
          }
        })();
      } else {
        if (result.data.nextQuestion) {
          // The next question (follow-up OR new topic — decided server-side)
          // is appended now; it didn't exist before this response.
          setQuestions((prev) => [...prev, result.data.nextQuestion]);
        }

        // Speak the reaction, then move on automatically once it's done —
        // gives the candidate a moment to hear the reaction without needing
        // a manual "Next Question" click to actually continue.
        (async () => {
          await speakText(result.data.spokenReaction);
          await handleNext();
        })();
      }

      setIsSubmitting(false)
    } catch (error) {
console.log(error)
setIsSubmitting(false)
    }
  }

  // Prevents handleNext from running twice if the auto-advance (after TTS
  // finishes) and a manual "Skip ahead" click happen to land at nearly the
  // same time — without this, currentIndex could increment twice in a row.
  const advancingRef = useRef(false);

  const handleNext = async () => {
    if (interviewComplete) {
      // Don't clear spokenReaction/answer here — that would flash the UI back
      // to the "Submit Answer" state for a moment before navigating to the
      // report. Just guard against double-calls and hand off to finish.
      if (isFinishing) return;
      setIsFinishing(true);
      await finishInterview();
      return;
    }

    if (advancingRef.current) return;
    advancingRef.current = true;

    answerRef.current = "";
    setAnswer("");
    setSpokenReaction("");

    // The next question's own `transition` line (spoken in the effect above,
    // triggered by currentIndex changing) replaces the old generic phrase here.
    setCurrentIndex((prev) => prev + 1);
    setTimeout(() => {
      if (isMicOn) startMic();
      advancingRef.current = false;
    }, 500);


  }

  const finishInterview = async () => {
    stopMic()
    setIsMicOn(false)

    try {
      const result = await axios.post(ServerUrl+ "/api/interview/finish" , { interviewId} , {withCredentials:true})

      console.log(result.data)
      onFinish(result.data)
    } catch (error) {
      console.log(error)
      setIsFinishing(false)
    }
  }


   useEffect(() => {
    if (isIntroPhase) return;
    if (!currentQuestion) return;

    if (timeLeft === 0 && !isSubmitting && !spokenReaction) {
      submitAnswer()
    }
  }, [timeLeft]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && recordingActiveRef.current) {
        try {
          mediaRecorderRef.current.stop();
        } catch { }
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      window.speechSynthesis.cancel();
    };
  }, []);







  return (
    <div className='min-h-screen bg-linear-to-br from-emerald-50 via-white to-teal-100 flex items-center justify-center p-4 sm:p-6'>
      <div className='w-full max-w-350 min-h-[80vh] bg-white rounded-3xl shadow-2xl border border-gray-200 flex flex-col lg:flex-row overflow-hidden'>

        {/* video section */}
        <div className='w-full lg:w-[35%] bg-white flex flex-col items-center p-6 space-y-6 border-r border-gray-200'>
          <div className='w-full max-w-md rounded-2xl overflow-hidden shadow-xl'>
            <video
              src={videoSource}
              key={videoSource}
              ref={videoRef}
              muted
              playsInline
              preload="auto"
              className="w-full h-auto object-cover"
            />
          </div>

          {/* subtitle */}
          {subtitle && (
            <div className='w-full max-w-md bg-gray-50 border border-gray-200 rounded-xl p-4 shadow-sm'>
              <p className='text-gray-700 text-sm sm:text-base font-medium text-center leading-relaxed'>{subtitle}</p>
            </div>
          )}


          {/* timer Area */}
          <div className='w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-md p-6 space-y-5'>
            <div className='flex justify-between items-center'>
              <span className='text-sm text-gray-500'>
                Interview Status
              </span>
              {isAIPlaying && <span className='text-sm font-semibold text-emerald-600'>
                {isAIPlaying ? "AI Speaking" : ""}
              </span>}
            </div>

            <div className="h-px bg-gray-200"></div>

            <div className='flex justify-center'>

              <Timer timeLeft={timeLeft} totalTime={currentQuestion?.timeLimit} />
            </div>

            <div className="h-px bg-gray-200"></div>

            <div className='grid grid-cols-2 gap-6 text-center'>
              <div>
                <span className='text-2xl font-bold text-emerald-600'>
                  {(currentQuestion?.topicIndex ?? 0) + 1}
                </span>
                <span className='text-xs text-gray-400'>Current Topic</span>
              </div>

              <div>
                <span className='text-2xl font-bold text-emerald-600'>{totalTopics || 5}</span>
                <span className='text-xs text-gray-400'>Total Topics</span>
              </div>
            </div>


          </div>
        </div>

        {/* Text section */}

        <div className='flex-1 flex flex-col p-4 sm:p-6 md:p-8 relative'>
          <h2 className='text-xl sm:text-2xl font-bold text-emerald-600 mb-6'>
            AI Smart Interview
          </h2>


          {!isIntroPhase && (<div className='relative mb-6 bg-gray-50 p-4 sm:p-6 rounded-2xl border border-gray-200 shadow-sm'>
            <p className='text-xs sm:text-sm text-gray-400 mb-2'>
              Topic {(currentQuestion?.topicIndex ?? 0) + 1} of {totalTopics || 5}
              {currentQuestion?.isFollowUp ? " · Follow-up" : ""}
            </p>

            <div className='text-base sm:text-lg font-semibold text-gray-800 leading-relaxed '>{currentQuestion?.question}</div>
          </div>)
          }

          {isIntroPhase ? (
            // Nothing is answerable yet — the AI hasn't asked the first question
            // out loud. Show a calm placeholder instead of a live textarea/mic/
            // submit, so there's nothing for the candidate to click prematurely
            // (which previously could submit an empty answer against the real
            // first question before it had even been asked).
            <div className='flex-1 flex flex-col'>
              <div className='flex-1 bg-gray-100 rounded-2xl border border-gray-200 p-4 sm:p-6 flex flex-col gap-3 animate-pulse'>
                <div className='h-4 bg-gray-200 rounded w-3/4'></div>
                <div className='h-4 bg-gray-200 rounded w-1/2'></div>
                <div className='h-4 bg-gray-200 rounded w-2/3'></div>
              </div>
              <div className='flex items-center gap-3 mt-6 text-gray-500'>
                <span className='w-2 h-2 rounded-full bg-emerald-500 animate-pulse'></span>
                <span className='text-sm font-medium'>
                  {isAIPlaying ? "Getting ready — listen to the introduction..." : "Getting ready..."}
                </span>
              </div>
              <div
                aria-hidden="true"
                className='mt-4 w-full bg-gray-300 text-white py-3 sm:py-4 rounded-2xl font-semibold text-center opacity-50 cursor-not-allowed select-none'>
                Submit Answer
              </div>
            </div>
          ) : (
            <>
          <textarea
            placeholder="Type your answer here, or use the mic..."
            onChange={(e) => {
              const value = e.target.value;
              answerRef.current = value;
              setAnswer(value);
            }}
            value={answer}
            className="flex-1 bg-gray-100 p-4 sm:p-6 rounded-2xl resize-none outline-none border border-gray-200 focus:ring-2 focus:ring-emerald-500 transition text-gray-800" />

          {(isRecording || isTranscribing || micError) && (
            <div className='mt-3 flex items-center gap-2 text-sm'>
              {isRecording && (
                <span className='flex items-center gap-2 text-rose-600 font-medium'>
                  <span className='w-2 h-2 rounded-full bg-rose-600 animate-pulse'></span>
                  Listening...
                </span>
              )}
              {isTranscribing && (
                <span className='text-emerald-600 font-medium'>Transcribing your answer...</span>
              )}
              {micError && !isRecording && !isTranscribing && (
                <span className='text-amber-600'>{micError}</span>
              )}
            </div>
          )}


         {!spokenReaction ? ( <div className='flex items-center gap-4 mt-6'>
            <motion.button
              onClick={toggleMic}
              whileTap={{ scale: 0.9 }}
              disabled={isSubmitting || isTranscribing}
              className={`w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full text-white shadow-lg disabled:opacity-50 transition ${
                isRecording ? "bg-rose-600" : "bg-black"
              }`}>
              {isMicOn ? <FaMicrophone size={20} /> : <FaMicrophoneSlash size={20}/>}
            </motion.button>

            <motion.button
            onClick={submitAnswer}
            disabled={isSubmitting || isTranscribing}
              whileTap={{ scale: 0.95 }}
              className='flex-1 bg-gradient-to-r from-emerald-600 to-teal-500 text-white py-3 sm:py-4 rounded-2xl shadow-lg hover:opacity-90 transition font-semibold disabled:bg-gray-500 disabled:cursor-not-allowed'>
              {isSubmitting ? "Submitting..." : isTranscribing ? "Transcribing..." : "Submit Answer"}

            </motion.button>

          </div>):(
            <motion.div 
             initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            className={`mt-6 border p-5 rounded-2xl shadow-sm ${
              interviewComplete
                ? "bg-teal-50 border-teal-200"
                : "bg-emerald-50 border-emerald-200"
            }`}>
              <p className={`font-medium mb-2 ${interviewComplete ? "text-teal-700" : "text-emerald-700"}`}>
                {spokenReaction}
              </p>

              {interviewComplete && outro && (
                <p className='text-teal-600 text-sm mb-4'>{outro}</p>
              )}

              <button
              onClick={handleNext}
              disabled={isSubmitting || isFinishing}

               className={`w-full text-white py-3 rounded-xl shadow-md transition flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed ${
                 interviewComplete
                   ? "bg-gradient-to-r from-teal-600 to-emerald-600 hover:opacity-90"
                   : "bg-gradient-to-r from-emerald-600 to-teal-500 hover:opacity-90"
               }`}>
                {interviewComplete
                  ? (isFinishing ? "Finishing up..." : "Continue to report")
                  : "Skip ahead"} <BsArrowRight size={18}/>
              </button>

              <p className='text-xs text-gray-400 text-center mt-2'>
                {interviewComplete ? "Wrapping up automatically..." : "Moving to the next question automatically..."}
              </p>

            </motion.div>
          )}
            </>
          )}
        </div>
      </div>

    </div>
  )
}

export default Step2Interview