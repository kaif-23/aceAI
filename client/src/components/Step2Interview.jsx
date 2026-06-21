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
  const recognitionRef = useRef(null);
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


  // Tracks whether the recognizer is currently active, so stopMicAndWait()
  // knows whether it actually needs to wait for an onend event at all.
  const recognitionActiveRef = useRef(false);

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window)) return;

    const recognition = new window.webkitSpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const transcript =
        event.results[event.results.length - 1][0].transcript;

      // Use the functional form of setAnswer so this always builds on the
      // LATEST state, never a value captured in a stale closure — this is
      // what makes typing and speaking safe to interleave. We update the ref
      // from inside the updater itself, so the ref and state can never
      // disagree with each other even if multiple updates land in the same tick.
      setAnswer((prev) => {
        const next = (prev + " " + transcript).trim();
        answerRef.current = next;
        return next;
      });
    };

    recognition.onstart = () => {
      recognitionActiveRef.current = true;
    };

    recognition.onend = () => {
      recognitionActiveRef.current = false;
    };

    recognitionRef.current = recognition;

  }, []);


  const startMic = () => {
    if (recognitionRef.current && !isAIPlaying) {
      try {
        recognitionRef.current.start();
      } catch { }
    }
  };

  const stopMic = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  // Stops the mic AND waits for any in-flight speech result to actually land
  // in answerRef before resolving. webkitSpeechRecognition.stop() does not
  // discard audio already captured — it finishes processing it and still
  // fires onresult/onend afterward. Submitting immediately after calling
  // stop() risks sending an answer that's missing the last few words (or is
  // still completely empty) because that final result hadn't arrived yet.
  const stopMicAndWait = () => {
    return new Promise((resolve) => {
      if (!recognitionRef.current || !recognitionActiveRef.current) {
        resolve();
        return;
      }

      const recognition = recognitionRef.current;
      const previousOnEnd = recognition.onend;

      // Give the recognizer a brief grace window to flush a final result
      // after stop() is called, instead of resolving the instant stop() returns.
      const settle = () => {
        recognition.onend = previousOnEnd;
        setTimeout(resolve, 250);
      };

      recognition.onend = () => {
        recognitionActiveRef.current = false;
        if (previousOnEnd) previousOnEnd();
        settle();
      };

      try {
        recognition.stop();
      } catch {
        settle();
      }

      // Safety net: if onend never fires for some reason, don't hang forever.
      setTimeout(resolve, 1200);
    });
  };

  const toggleMic = () => {
    if (isMicOn) {
      stopMic();
    } else {
      startMic();
    }
    setIsMicOn(!isMicOn);
  };


  const submitAnswer = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true)

    // Wait for any in-flight speech recognition result to land before reading
    // the final answer — this is what prevents "I definitely said something
    // but the report shows no answer" when the user finishes speaking right
    // as they click Submit.
    await stopMicAndWait();
    const finalAnswer = answerRef.current.trim();
    // Reflect the settled value in the UI too, in case a late result arrived
    // after the last render but before this point.
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
        // back-to-back — this is the "interview is actually over" moment, so
        // it should feel like one continuous closing, not a reaction followed
        // by silence until a button click later triggers the outro.
        (async () => {
          await speakText(result.data.spokenReaction);
          if (finalOutro) await speakText(finalOutro);
        })();
      } else {
        speakText(result.data.spokenReaction);
        if (result.data.nextQuestion) {
          // The next question (follow-up OR new topic — decided server-side)
          // is appended now; it didn't exist before this response.
          setQuestions((prev) => [...prev, result.data.nextQuestion]);
        }
      }

      setIsSubmitting(false)
    } catch (error) {
console.log(error)
setIsSubmitting(false)
    }
  }

  const handleNext = async () => {
    if (interviewComplete) {
      // Don't clear spokenReaction/answer here — that would flash the UI back
      // to the "Submit Answer" state for a moment before navigating to the
      // report. Just guard against double-clicks and hand off to finish.
      if (isFinishing) return;
      setIsFinishing(true);
      await finishInterview();
      return;
    }

    answerRef.current = "";
    setAnswer("");
    setSpokenReaction("");

    // The next question's own `transition` line (spoken in the effect above,
    // triggered by currentIndex changing) replaces the old generic phrase here.
    setCurrentIndex((prev) => prev + 1);
    setTimeout(() => {
      if (isMicOn) startMic();
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
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current.abort();
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
          <textarea
            placeholder="Type your answer here..."
            onChange={(e) => {
              const value = e.target.value;
              answerRef.current = value;
              setAnswer(value);
            }}
            value={answer}
            className="flex-1 bg-gray-100 p-4 sm:p-6 rounded-2xl resize-none outline-none border border-gray-200 focus:ring-2 focus:ring-emerald-500 transition text-gray-800" />


         {!spokenReaction ? ( <div className='flex items-center gap-4 mt-6'>
            <motion.button
              onClick={toggleMic}
              whileTap={{ scale: 0.9 }}
              disabled={isSubmitting}
              className='w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full bg-black text-white shadow-lg disabled:opacity-50'>
              {isMicOn ? <FaMicrophone size={20} /> : <FaMicrophoneSlash size={20}/>}
            </motion.button>

            <motion.button
            onClick={submitAnswer}
            disabled={isSubmitting}
              whileTap={{ scale: 0.95 }}
              className='flex-1 bg-gradient-to-r from-emerald-600 to-teal-500 text-white py-3 sm:py-4 rounded-2xl shadow-lg hover:opacity-90 transition font-semibold disabled:bg-gray-500 disabled:cursor-not-allowed'>
              {isSubmitting?"Submitting...":"Submit Answer"}

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
                  ? (isFinishing ? "Finishing up..." : "Interview Completed ✓")
                  : "Next Question"} <BsArrowRight size={18}/>
              </button>

            </motion.div>
          )}
        </div>
      </div>

    </div>
  )
}

export default Step2Interview