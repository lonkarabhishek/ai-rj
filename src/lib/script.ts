import type { Prefs, TrackInfo, Humor, Language, ListenMode } from "./prefs";
import type { Headline } from "./news";

export interface SegmentInput {
  prefs: Prefs;
  next?: TrackInfo | null;
  prev?: TrackInfo | null;
  index: number;
  mode?: ListenMode;
  recent?: string[];
  hour?: number; // listener's local hour, for time-of-day banter // recent scripts, used to avoid repeating lines
  headlines: Headline[];
}

let RECENT: string[] = [];
const pick = (a: string[]) => {
  const fresh = a.filter((x) => !RECENT.some((r) => r.includes(x.slice(0, 25))));
  const pool = fresh.length ? fresh : a;
  return pool[Math.floor(Math.random() * pool.length)];
};

const GREET: Record<"en" | "hl" | "hi" | "mr", string[]> = {
  en: ["{rj} back with you, {me}", "Still here, still vibing, {me}", "That was a good one, {me}", "Okay {me}, keeping the streak going", "You know the drill, {me}", "{rj} on the mic again"],
  hl: ["{rj} wapas aa gaya, {me}", "Kya gaana tha yaar, {me}", "Mood ekdum set hai, {me}", "Chaliye {me}, aage badhte hain", "{rj} phir se mic pe", "Arre {me}, maza aa raha hai na?"],
  hi: ["{rj} फिर से हाज़िर है, {me}", "क्या गाना था, {me}", "मूड बना हुआ है, {me}", "चलिए {me}, आगे बढ़ते हैं"],
  mr: ["{rj} पुन्हा तुमच्यासोबत, {me}", "काय गाणं होतं, {me}", "मूड एकदम सेट आहे, {me}", "चला {me}, पुढे जाऊया"],
};
type K = "en" | "hl" | "hi" | "mr";
function banter(k: K, hour: number | undefined, me: string): string {
  const h = hour ?? 12;
  const slot = h < 5 ? "late" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "late";
  const B: Record<K, Record<string, string[]>> = {
    en: {
      morning: [`Morning energy check, ${me}: coffee first, world later.`, `Fresh morning, fresh playlist. Let's make today count.`],
      afternoon: [`Afternoon slump? Not on this station.`, `Half the day done, ${me}. The good half starts now.`],
      evening: [`Evening mode on. Shoulders down, volume up.`, `Long day, ${me}? This next stretch is just for you.`],
      late: [`Late night crew, I see you, ${me}.`, `It's late, the city's quiet, and the music's just right.`],
      any: [`Honestly ${me}, your taste in music is elite.`, `If this station had a fan club, you'd be president.`, `Little reminder: drink some water, ${me}.`],
    },
    hl: {
      morning: [`Good morning ${me}! Pehle chai, phir duniya.`, `Subah subah ka mood ekdum fresh hai.`],
      afternoon: [`Dopahar ki neend aa rahi hai? Is station pe allowed nahi hai.`, `Aadha din ho gaya ${me}, ab asli maza shuru.`],
      evening: [`Shaam ho gayi ${me}, thoda relax karo, volume badhao.`, `Lamba din tha? Ye agla stretch sirf aapke liye.`],
      late: [`Raat ke jaagne waalon ko salaam, ${me}.`, `Raat shaant hai, aur music ekdum perfect.`],
      any: [`Sach bolun ${me}, aapka music taste top class hai.`, `Is station ka fan club hota toh aap president hote.`, `Chhota sa reminder: paani pee lo, ${me}.`],
    },
    hi: {
      morning: [`सुप्रभात ${me}! पहले चाय, फिर दुनिया।`], afternoon: [`दोपहर की सुस्ती? इस स्टेशन पर मना है।`],
      evening: [`शाम हो गई ${me}, थोड़ा आराम कीजिए।`], late: [`रात के जागने वालों को सलाम, ${me}।`],
      any: [`सच कहूँ ${me}, आपकी पसंद कमाल की है।`, `छोटा सा रिमाइंडर: पानी पी लीजिए, ${me}।`],
    },
    mr: {
      morning: [`सुप्रभात ${me}! आधी चहा, मग जग.`], afternoon: [`दुपारची झोप? या स्टेशनवर नाही चालणार.`],
      evening: [`संध्याकाळ झाली ${me}, जरा आराम करा.`], late: [`रात्री जागणाऱ्यांना सलाम, ${me}.`],
      any: [`खरं सांगू ${me}, तुमची गाण्यांची आवड भारी आहे.`, `छोटीशी आठवण: पाणी प्या, ${me}.`],
    },
  };
  return pick([...B[k][slot], ...B[k].any]);
}

const UPNEXT: Record<"en" | "hl" | "hi" | "mr", string[]> = {
  en: ["Up next, {t}", "Here comes {t}", "Turning it up with {t}", "Let's roll into {t}", "Coming right up, {t}"],
  hl: ["Ab sunte hain {t}", "Agla gaana, {t}", "Volume up karo, aa raha hai {t}", "Chalo, {t} bajate hain", "Ye raha {t}"],
  hi: ["अब सुनिए {t}", "अगला गाना, {t}", "आवाज़ बढ़ाइए, आ रहा है {t}"],
  mr: ["आता ऐकूया {t}", "पुढचं गाणं, {t}", "आवाज वाढवा, येतंय {t}"],
};

// ---- Jokes (template mode). Keyed by humor; English + Hindi-ish variants.
const JOKES: Record<Exclude<Humor, "off">, { en: string[]; hi: string[]; mr: string[] }> = {
  clean: {
    en: ["My alarm and I have an agreement. It rings, I ignore it, we both move on.", "I tried to catch some fog this morning. I mist.", "Chai is not a drink, it is a meeting with yourself.", "Why did the playlist go to school? To get a little more class-ical.", "I told my speaker a joke. It didn't laugh, but it did get louder."],
    hi: ["मेरे फोन ने कहा बैटरी लो है, मैंने कहा मैं भी, चलो साथ में चार्ज होते हैं।", "गाना इतना अच्छा है कि मेरा हेडफोन भी नाच रहा है।"],
    mr: ["माझा फोन म्हणाला बॅटरी कमी आहे, मी म्हणालो मी पण, चल एकत्र चार्ज होऊया.", "हे गाणं इतकं भारी आहे की हेडफोन पण नाचतायत."],
  },
  normal: {
    en: ["Why do we park on a driveway and drive on a parkway? Nobody knows, keep listening.", "My Wi-Fi and I have a lot in common. We both disconnect when things get serious.", "I'm on a seafood diet. I see food, I skip the gym.", "My code works and I have no idea why. Same energy as my love life.", "Traffic in Pune is the only place where patience is a cardio workout."],
    hi: ["Monday को देखकर लगता है जैसे EMI की तरह हर हफ्ते आ ही जाता है।", "दोस्त बोला diet पर हूँ, फिर समोसा देखा, diet ने खुद resign कर दिया।"],
    mr: ["सोमवार म्हणजे EMI सारखा, दर आठवड्याला येतोच.", "मित्र म्हणाला डाएटवर आहे, मग वडापाव दिसला आणि डाएटने राजीनामा दिला."],
  },
  witty: {
    en: ["My to-do list and I are in a long-distance relationship. I never see the bottom of it.", "I asked the AI for life advice. It said: have you tried turning yourself off and on again?", "Every startup pitch now: it's like Uber, but for vibes, powered by AI.", "Pune weather has three settings: hot, rain, and confusing.", "AI can write code, compose music and pass exams, but still can't find the one sock the washing machine ate.", "My calendar says I'm productive. My screen time report disagrees, loudly."],
    hi: ["AI code लिख लेता है, गाने बना लेता है, पर washing machine ने जो मोजा खाया वो आज तक नहीं ढूंढ पाया।", "मेरा calendar कहता है मैं productive हूँ, screen time report कहती है झूठ मत बोल।"],
    mr: ["AI कोड लिहितो, गाणी बनवतो, पण वॉशिंग मशीनने खाल्लेला मोजा अजून सापडला नाही.", "कॅलेंडर म्हणतं मी productive आहे, स्क्रीन टाइम म्हणतो खोटं बोलू नकोस."],
  },
  dark: {
    en: ["My bank balance and my sleep schedule have one thing in common. Both are a cry for help.", "I'm not saying Monday is evil, but it has never once been seen in a mirror.", "I would tell you a joke about my career plans, but it doesn't have a punchline either.", "I told my plants about my deadlines. Two of them are no longer with us.", "They say money can't buy happiness. It can't buy rent either, apparently, so at least it's consistent."],
    hi: ["मैंने अपने पौधों को अपनी deadlines बताईं, दो पौधे अब हमारे बीच नहीं रहे।", "कहते हैं पैसा खुशी नहीं खरीद सकता, मेरे पास तो किराया खरीदने लायक भी नहीं, कम से कम consistent तो हूँ।"],
    mr: ["मी माझ्या झाडांना माझ्या deadlines सांगितल्या, दोन झाडं आता आपल्यात नाहीत.", "पैशाने सुख विकत घेता येत नाही म्हणतात, माझ्याकडे भाडं भरण्याइतके पण नाहीत, निदान सातत्य तरी आहे."],
  },
};

function jokeFor(humor: Humor, lang: Language) {
  if (humor === "off") return "";
  const set = JOKES[humor];
  return pick(lang === "english" || lang === "hinglish" ? set.en : lang === "marathi" ? set.mr : set.hi);
}

function shortTitle(t: string) { return t.length > 140 ? t.slice(0, 140).replace(/\s\S*$/, "") : t; }

function trackLine(t?: TrackInfo | null) {
  return t ? `"${t.name}" by ${t.artists}` : "";
}

const MODE_LINES: Record<"gym" | "drive" | "focus", Record<"en" | "hi" | "hl" | "mr", string[]>> = {
  gym: {
    en: ["Stronger than yesterday, {me}. Prove it!", "Your only competition is who you were last week!", "Form first, then fire!", "One more rep, {me}. Pain is temporary, gains are forever!", "No excuses today, {me}. Let's crush this set!", "Breathe, brace, and lift, {me}. You've got this!"],
    hl: ["Kal se strong ho aap, {me}, prove karo!", "Competition sirf pichle hafte waale aap se hai!", "Pehle form, phir fire!", "Ek aur rep, {me}! Dard temporary hai, gains permanent!", "Aaj koi excuse nahi, {me}. Set todo!", "Saans lo, focus karo, aur utha do, {me}!"],
    hi: ["एक और रेप, {me}! दर्द कुछ पल का है, ताकत हमेशा की!", "आज कोई बहाना नहीं, {me}। ये सेट तोड़ दो!"],
    mr: ["अजून एक रेप, {me}! वेदना क्षणभर, ताकद कायमची!", "आज कोणतीही सबब नाही, {me}. हा सेट फोडून टाका!"],
  },
  drive: {
    en: ["Long road, good company, better music.", "If there's traffic, this song is your excuse to sing louder.", "Windows down, volume up, {me}. Sing it like nobody's listening!", "Road's open, {me}. This one's a singalong, don't hold back!"],
    hl: ["Lambi road, achhi company, aur usse bhi achha music.", "Traffic mein phase ho? Toh aur zor se gaao!", "Windows neeche, volume upar, {me}! Gaana zor se gaana!", "Road khula hai, {me}. Is gaane pe singalong compulsory hai!"],
    hi: ["खिड़कियाँ नीचे, आवाज़ ऊपर, {me}! ज़ोर से गाइए!", "सड़क खुली है, {me}। इस गाने पर साथ में गाना ज़रूरी है!"],
    mr: ["खिडक्या खाली, आवाज वर, {me}! मोठ्याने गा!", "रस्ता मोकळा आहे, {me}. या गाण्यावर सोबत गायलंच पाहिजे!"],
  },
  focus: {
    en: ["Staying in the zone with {track}.", "Deep work continues, {me}. Next up, {track}.", "Quiet focus, steady flow. Here's {track}.", "You're doing great, {me}. Keep going with {track}."],
    hl: ["Focus mode on, {me}. Ab {track}.", "Zone mein raho, {me}. Next, {track}.", "Kaam chalta rahe, {me}. Saath mein {track}.", "Badhiya chal raha hai, {me}. Ab {track}."],
    hi: ["फोकस बनाए रखिए, {me}। अब {track}।"],
    mr: ["लक्ष केंद्रित ठेवा, {me}. आता {track}."],
  },
};

export function templateScript(input: SegmentInput): string {
  RECENT = input.recent ?? [];
  return templateInner(input);
}
function templateInner({ prefs, next, index, headlines, mode = "default", hour: input_hour }: SegmentInput): string {
  if (mode !== "default") {
    const k: K = prefs.language === "english" ? "en" : prefs.language === "hinglish" ? "hl" : prefs.language === "hindi" ? "hi" : "mr";
    const me = prefs.listenerName;
    const fill = (x: string) => x.replace("{me}", me).replace("{track}", trackLine(next) || "the next one");
    const tl = trackLine(next);
    const upnext = tl ? pick(UPNEXT[k]).replace("{t}", tl) + "!" : "";
    const intro = index === 0 ? `${prefs.rjName} ${k === "en" ? "here" : k === "hl" ? "aa gaya" : k === "hi" ? "हाज़िर है" : "आला"}! ` : "";
    if (mode === "focus") return intro + fill(pick(MODE_LINES.focus[k]));
    if (mode === "gym") {
      const l1 = fill(pick(MODE_LINES.gym[k]));
      RECENT = [...RECENT, l1];
      const l2 = fill(pick(MODE_LINES.gym[k]));
      return [intro + l1, l2 !== l1 ? l2 : "", upnext].filter(Boolean).join(" ");
    }
    // drive: banter + road line + joke + a headline every other break + intro
    const g0 = index === 0 ? "" : pick(GREET[k]).replace("{rj}", prefs.rjName).replace("{me}", me);
    const g = g0 && !/[?!]$/.test(g0) ? g0 + "!" : g0;
    const news = index % 2 === 0 && headlines[0] ? `${k === "en" ? "On the news front" : k === "hl" ? "Ek quick khabar" : k === "hi" ? "एक ताज़ा खबर" : "एक ताजी बातमी"}: ${shortTitle(headlines[0].title)}.` : "";
    const joke = prefs.humor !== "off" ? jokeFor(prefs.humor, prefs.language) : "";
    return [(intro + g).trim(), fill(pick(MODE_LINES.drive[k])), news, joke, upnext].filter(Boolean).join(" ");
  }
  const { rjName, listenerName: me, language, humor, energy } = prefs;
  const hype = energy === "hype" ? "!" : ".";
  const joke = jokeFor(humor, language);
  const news = (index % 2 === 0 ? headlines.slice(0, 2) : []).map((h) => ({ ...h, title: shortTitle(h.title) }));
  const tl = trackLine(next);
  const parts: string[] = [];
  const k = language === "english" ? "en" : language === "hinglish" ? "hl" : language === "hindi" ? "hi" : "mr";
  const greetRaw = pick(GREET[k]).replace("{rj}", rjName).replace("{me}", me);
  const greet = /[?!]$/.test(greetRaw) ? greetRaw : greetRaw + hype;
  const upnext = tl ? pick(UPNEXT[k]).replace("{t}", tl) + hype : "";
  const chat = banter(k, input_hour, me);

  switch (language) {
    case "english":
      parts.push(index === 0 ? `Hey ${me}, you're tuned in to ${rjName}, your very own radio${hype}` : greet);
      parts.push(chat);
      if (news.length) parts.push(`Quick news check: ${news.map((h) => h.title).join(". Also, ")}.`);
      if (joke) parts.push(joke);
      if (upnext) parts.push(upnext);
      break;
    case "hindi":
      parts.push(index === 0 ? `नमस्ते ${me}, आप सुन रहे हैं ${rjName}, सिर्फ आपका अपना रेडियो${hype}` : greet);
      parts.push(chat);
      if (news.length) parts.push(`ताज़ा खबरें: ${news.map((h) => h.title).join("। और, ")}।`);
      if (joke) parts.push(joke);
      if (upnext) parts.push(upnext);
      break;
    case "marathi":
      parts.push(index === 0 ? `नमस्कार ${me}, तुम्ही ऐकताय ${rjName}, फक्त तुमचा स्वतःचा रेडिओ${hype}` : greet);
      parts.push(chat);
      if (news.length) parts.push(`ताज्या बातम्या: ${news.map((h) => h.title).join(". आणि, ")}.`);
      if (joke) parts.push(joke);
      if (upnext) parts.push(upnext);
      break;
    default: // hinglish
      parts.push(index === 0 ? `Hello ${me}, aap sun rahe ho ${rjName}, sirf aapka apna radio${hype}` : greet);
      parts.push(chat);
      if (news.length) parts.push(`Quick news update: ${news.map((h) => h.title).join(". Aur, ")}.`);
      if (joke) parts.push(joke);
      if (upnext) parts.push(upnext);
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
  const sys = `You are ${prefs.rjName}, a radio jockey for one listener named ${prefs.listenerName}. Speak only in ${prefs.language} (Hindi/Marathi in Devanagari; Hinglish in Roman script). Energy: ${prefs.energy}. Humor style: ${prefs.humor}. Output only the spoken words, no stage directions, no emojis. ${
    input.mode === "gym" ? "Listening mode: GYM. Be a hype coach: short punchy motivational lines, max 30 words." :
    input.mode === "drive" ? "Listening mode: DRIVING. Playful road-trip buddy vibe, encourage singing along, max 45 words." :
    input.mode === "focus" ? "Listening mode: WORK/FOCUS. Calm, minimal, max 12 words, just name the next track." : "40-80 words."}`;
  const user = [
    index === 0 ? "This is the show opener." : `Previous song: ${trackLine(prev) || "none"}.`,
    `Next song: ${trackLine(next) || "none"}.`,
    input.mode && input.mode !== "default" ? "No news." : index % 2 === 0 && headlines.length ? `Mention 1-2 of these headlines briefly: ${headlines.slice(0, 4).map((h) => h.title).join(" | ")}` : "No news this time.",
    input.mode === "gym" || input.mode === "focus" ? "No jokes." : prefs.humor !== "off" ? "Include one short joke in the listener's humor style." : "No jokes.",
    input.recent?.length ? `Do not reuse these recent lines: ${input.recent.slice(-3).join(" || ")}` : "",
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
