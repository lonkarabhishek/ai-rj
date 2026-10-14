import type { Prefs, TrackInfo, Humor, Language } from "./prefs";
import type { Headline } from "./news";

export interface SegmentInput {
  prefs: Prefs;
  next?: TrackInfo | null;
  prev?: TrackInfo | null;
  index: number;
  headlines: Headline[];
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

// ---- Jokes (template mode). Keyed by humor; English + Hindi-ish variants.
const JOKES: Record<Exclude<Humor, "off">, { en: string[]; hi: string[]; mr: string[] }> = {
  clean: {
    en: ["Why did the playlist go to school? To get a little more class-ical.", "I told my speaker a joke. It didn't laugh, but it did get louder."],
    hi: ["मेरे फोन ने कहा बैटरी लो है, मैंने कहा मैं भी, चलो साथ में चार्ज होते हैं।", "गाना इतना अच्छा है कि मेरा हेडफोन भी नाच रहा है।"],
    mr: ["माझा फोन म्हणाला बॅटरी कमी आहे, मी म्हणालो मी पण, चल एकत्र चार्ज होऊया.", "हे गाणं इतकं भारी आहे की हेडफोन पण नाचतायत."],
  },
  normal: {
    en: ["My Wi-Fi and I have a lot in common. We both disconnect when things get serious.", "I'm on a seafood diet. I see food, I skip the gym."],
    hi: ["Monday को देखकर लगता है जैसे EMI की तरह हर हफ्ते आ ही जाता है।", "दोस्त बोला diet पर हूँ, फिर समोसा देखा, diet ने खुद resign कर दिया।"],
    mr: ["सोमवार म्हणजे EMI सारखा, दर आठवड्याला येतोच.", "मित्र म्हणाला डाएटवर आहे, मग वडापाव दिसला आणि डाएटने राजीनामा दिला."],
  },
  witty: {
    en: ["AI can write code, compose music and pass exams, but still can't find the one sock the washing machine ate.", "My calendar says I'm productive. My screen time report disagrees, loudly."],
    hi: ["AI code लिख लेता है, गाने बना लेता है, पर washing machine ने जो मोजा खाया वो आज तक नहीं ढूंढ पाया।", "मेरा calendar कहता है मैं productive हूँ, screen time report कहती है झूठ मत बोल।"],
    mr: ["AI कोड लिहितो, गाणी बनवतो, पण वॉशिंग मशीनने खाल्लेला मोजा अजून सापडला नाही.", "कॅलेंडर म्हणतं मी productive आहे, स्क्रीन टाइम म्हणतो खोटं बोलू नकोस."],
  },
  dark: {
    en: ["I told my plants about my deadlines. Two of them are no longer with us.", "They say money can't buy happiness. It can't buy rent either, apparently, so at least it's consistent."],
    hi: ["मैंने अपने पौधों को अपनी deadlines बताईं, दो पौधे अब हमारे बीच नहीं रहे।", "कहते हैं पैसा खुशी नहीं खरीद सकता, मेरे पास तो किराया खरीदने लायक भी नहीं, कम से कम consistent तो हूँ।"],
    mr: ["मी माझ्या झाडांना माझ्या deadlines सांगितल्या, दोन झाडं आता आपल्यात नाहीत.", "पैशाने सुख विकत घेता येत नाही म्हणतात, माझ्याकडे भाडं भरण्याइतके पण नाहीत, निदान सातत्य तरी आहे."],
  },
};

function jokeFor(humor: Humor, lang: Language) {
  if (humor === "off") return "";
  const set = JOKES[humor];
  return pick(lang === "english" || lang === "hinglish" ? set.en : lang === "marathi" ? set.mr : set.hi);
}

function trackLine(t?: TrackInfo | null) {
  return t ? `"${t.name}" by ${t.artists}` : "";
}

export function templateScript({ prefs, next, index, headlines }: SegmentInput): string {
  const { rjName, listenerName: me, language, humor, energy } = prefs;
  const hype = energy === "hype" ? "!" : ".";
  const joke = jokeFor(humor, language);
  const news = index % 2 === 0 ? headlines.slice(0, 2) : [];
  const tl = trackLine(next);
  const parts: string[] = [];

  switch (language) {
    case "english":
      parts.push(index === 0 ? `Hey ${me}, you're tuned in to ${rjName}, your very own radio${hype}` : `${rjName} back with you, ${me}${hype}`);
      if (news.length) parts.push(`Quick news check: ${news.map((h) => h.title).join(". Also, ")}.`);
      if (joke) parts.push(joke);
      if (tl) parts.push(`Up next, ${tl}. Let's go${hype}`);
      break;
    case "hindi":
      parts.push(index === 0 ? `नमस्ते ${me}, आप सुन रहे हैं ${rjName}, सिर्फ आपका अपना रेडियो${hype}` : `${rjName} फिर से हाज़िर है, ${me}${hype}`);
      if (news.length) parts.push(`ताज़ा खबरें: ${news.map((h) => h.title).join("। और, ")}।`);
      if (joke) parts.push(joke);
      if (tl) parts.push(`अब सुनिए ${tl}${hype}`);
      break;
    case "marathi":
      parts.push(index === 0 ? `नमस्कार ${me}, तुम्ही ऐकताय ${rjName}, फक्त तुमचा स्वतःचा रेडिओ${hype}` : `${rjName} पुन्हा तुमच्यासोबत, ${me}${hype}`);
      if (news.length) parts.push(`ताज्या बातम्या: ${news.map((h) => h.title).join(". आणि, ")}.`);
      if (joke) parts.push(joke);
      if (tl) parts.push(`आता ऐकूया ${tl}${hype}`);
      break;
    default: // hinglish
      parts.push(index === 0 ? `Hello ${me}, aap sun rahe ho ${rjName}, sirf aapka apna radio${hype}` : `${rjName} wapas aa gaya, ${me}${hype}`);
      if (news.length) parts.push(`Quick news update: ${news.map((h) => h.title).join(". Aur, ")}.`);
      if (joke) parts.push(joke);
      if (tl) parts.push(`Ab sunte hain ${tl}. Volume up karo${hype}`);
  }
  return parts.join(" ");
}

// ---- Optional LLM mode: any OpenAI-compatible API (OpenAI, Groq, OpenRouter, xAI...).
// Set OPENAI_API_KEY (+ optional LLM_BASE_URL, LLM_MODEL) to enable.
export async function llmScript(input: SegmentInput): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (!key) return null;
  const base = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const { prefs, next, prev, index, headlines } = input;
  const sys = `You are ${prefs.rjName}, a radio jockey for one listener named ${prefs.listenerName}. Speak only in ${prefs.language} (Hindi/Marathi in Devanagari; Hinglish in Roman script). Energy: ${prefs.energy}. Humor style: ${prefs.humor}. Output only the spoken words, 40-80 words, no stage directions, no emojis.`;
  const user = [
    index === 0 ? "This is the show opener." : `Previous song: ${trackLine(prev) || "none"}.`,
    `Next song: ${trackLine(next) || "none"}.`,
    index % 2 === 0 && headlines.length ? `Mention 1-2 of these headlines briefly: ${headlines.slice(0, 4).map((h) => h.title).join(" | ")}` : "No news this time.",
    prefs.humor !== "off" ? "Include one short joke in the listener's humor style." : "No jokes.",
  ].join("\n");
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0.9 }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}
